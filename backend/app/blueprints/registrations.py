import io
import uuid

import qrcode
from flask import Blueprint, jsonify, send_file
from flask_jwt_extended import get_jwt, get_jwt_identity
from sqlalchemy import text

from app.decorators import role_required
from app.extensions import db
from app.models import Event, Registration, TokenStatus

registrations_bp = Blueprint("registrations", __name__)


@registrations_bp.route("/api/events/<int:event_id>/register", methods=["POST"])
@role_required("attendee")
def register_for_event(event_id):
    """
    Register the current attendee for an event.

    Uses an atomic conditional UPDATE on events.registered_count to enforce
    capacity at the database level — safe against concurrent requests.
    The registration row and counter increment are committed in a single
    transaction so they're all-or-nothing.
    """
    identity = int(get_jwt_identity())

    # Verify the event exists (lightweight read before the atomic write)
    event = Event.query.get(event_id)
    if not event:
        return jsonify({"error": "Event not found"}), 404

    # Check for duplicate registration BEFORE the atomic capacity update.
    # The (event_id, user_id) unique constraint is the ultimate backstop,
    # but this gives a clean 409 message without burning a counter slot.
    existing = Registration.query.filter_by(
        event_id=event_id, user_id=identity
    ).first()
    if existing:
        return (
            jsonify({"error": "You are already registered for this event"}),
            409,
        )

    # ------------------------------------------------------------------
    # ATOMIC CAPACITY CHECK + INCREMENT
    #
    # A single UPDATE that only succeeds if registered_count < capacity.
    # Because the condition and the increment happen in one SQL statement,
    # concurrent requests cannot both "see" a free slot — the database
    # serializes them via row-level locking.
    # ------------------------------------------------------------------
    result = db.session.execute(
        text(
            "UPDATE events "
            "SET registered_count = registered_count + 1 "
            "WHERE id = :event_id AND registered_count < capacity "
            "RETURNING registered_count"
        ),
        {"event_id": event_id},
    )
    row = result.fetchone()

    if row is None:
        # UPDATE matched 0 rows → event is at capacity
        db.session.rollback()
        return jsonify({"error": "Event is at full capacity"}), 409

    # Create the Registration row in the SAME transaction.
    # If this fails (e.g. unique constraint race on qr_token), the counter
    # increment is rolled back automatically — both writes are atomic.
    qr_token = str(uuid.uuid4())
    registration = Registration(
        event_id=event_id,
        user_id=identity,
        qr_token=qr_token,
        token_status=TokenStatus.active,
    )
    db.session.add(registration)

    try:
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    # Refresh the event object so the caller sees the updated counter
    db.session.refresh(event)

    return (
        jsonify(
            {
                "message": "Registration successful",
                "registration": registration.to_dict(),
                "event": event.to_dict(),
            }
        ),
        201,
    )


@registrations_bp.route("/api/registrations/me", methods=["GET"])
@role_required("attendee")
def my_registrations():
    """Return the current attendee's own registrations with event info. Attendee only."""
    identity = int(get_jwt_identity())

    registrations = (
        Registration.query.filter_by(user_id=identity)
        .order_by(Registration.created_at.desc())
        .all()
    )

    result = []
    for reg in registrations:
        reg_dict = reg.to_dict()
        reg_dict["event"] = reg.event.to_dict()
        result.append(reg_dict)

    return jsonify({"registrations": result}), 200


@registrations_bp.route(
    "/api/events/<int:event_id>/registrations", methods=["GET"]
)
@role_required("organizer")
def event_registrations(event_id):
    """Return all registrations for an event. Organizer only, owner only."""
    identity = int(get_jwt_identity())
    event = Event.query.get(event_id)

    if not event:
        return jsonify({"error": "Event not found"}), 404

    if event.organizer_id != identity:
        return (
            jsonify(
                {"error": "Forbidden: you can only view registrations for your own events"}
            ),
            403,
        )

    registrations = (
        Registration.query.filter_by(event_id=event_id)
        .order_by(Registration.created_at.desc())
        .all()
    )

    result = []
    for reg in registrations:
        reg_dict = reg.to_dict()
        reg_dict["user_email"] = reg.user.email
        result.append(reg_dict)

    return jsonify({"registrations": result}), 200


@registrations_bp.route(
    "/api/registrations/<int:registration_id>/qr-image", methods=["GET"]
)
def qr_image(registration_id):
    """
    Generate a QR code PNG server-side encoding the qr_token.

    Accessible by:
    - The attendee who owns the registration
    - The organizer who owns the parent event
    Returns 403 otherwise.
    """
    from flask_jwt_extended import verify_jwt_in_request

    verify_jwt_in_request()
    identity = int(get_jwt_identity())
    claims = get_jwt()
    role = claims.get("role")

    registration = Registration.query.get(registration_id)
    if not registration:
        return jsonify({"error": "Registration not found"}), 404

    # Authorization: owner (attendee) or event organizer
    is_owner = registration.user_id == identity
    is_event_organizer = (
        role == "organizer" and registration.event.organizer_id == identity
    )

    if not is_owner and not is_event_organizer:
        return (
            jsonify({"error": "Forbidden: you do not have access to this QR code"}),
            403,
        )

    # Generate QR code PNG in memory
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=10,
        border=4,
    )
    qr.add_data(registration.qr_token)
    qr.make(fit=True)

    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    buf.seek(0)

    return send_file(
        buf,
        mimetype="image/png",
        as_attachment=False,
        download_name=f"qr_{registration.qr_token}.png",
    )
