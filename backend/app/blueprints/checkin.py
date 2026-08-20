"""
Check-in endpoint — scan a QR token to check an attendee in.

Implements the exact transactional pattern:
  1. SELECT ... FOR UPDATE on Registration (row lock)
  2. If already used → 409 with checked_in_at timestamp
  3. Flip token_status to "used"
  4. Atomic UPDATE Event.checked_in_count + 1
  5. Insert CheckIn row
  All in one transaction — commits on success, rolls back entirely on failure.

The UNIQUE constraint on CheckIn.registration_id is the belt-and-suspenders
safety net: if a concurrent request somehow slips past the row lock, the
IntegrityError is caught and returns the same 409 response.
"""

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.decorators import role_required
from app.extensions import db
from app.models import CheckIn, Event, Registration, TokenStatus

checkin_bp = Blueprint("checkin", __name__)


@checkin_bp.route("/api/checkin", methods=["POST"])
@role_required("organizer")
def checkin():
    """
    Scan a QR token to check in an attendee.

    Body: { "qr_token": str, "station_id": str }
    Access: organizer only, and organizer must own the event.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    qr_token = data.get("qr_token", "").strip()
    station_id = data.get("station_id", "").strip()

    if not qr_token:
        return jsonify({"error": "qr_token is required"}), 400
    if not station_id:
        return jsonify({"error": "station_id is required"}), 400

    identity = int(get_jwt_identity())

    try:
        with db.session.begin_nested():
            # 1. Lock the registration row — prevents concurrent check-ins
            #    on the same qr_token from proceeding simultaneously.
            registration = db.session.execute(
                select(Registration)
                .where(Registration.qr_token == qr_token)
                .with_for_update()
            ).scalar_one_or_none()

            if registration is None:
                return jsonify({"error": "Invalid QR code"}), 404

            # Authorization: organizer must own the event
            event = db.session.get(Event, registration.event_id)
            if event.organizer_id != identity:
                return (
                    jsonify(
                        {
                            "error": "Forbidden: you can only check in attendees for your own events"
                        }
                    ),
                    403,
                )

            # 2. Already checked in?
            if registration.token_status == TokenStatus.used:
                existing_checkin = db.session.execute(
                    select(CheckIn).where(
                        CheckIn.registration_id == registration.id
                    )
                ).scalar_one_or_none()

                checked_in_at = (
                    existing_checkin.checked_in_at.isoformat()
                    if existing_checkin
                    else None
                )
                return (
                    jsonify(
                        {
                            "error": "Already checked in",
                            "checked_in_at": checked_in_at,
                        }
                    ),
                    409,
                )

            # 3. Flip token status
            registration.token_status = TokenStatus.used

            # 4. Atomic increment of checked_in_count
            db.session.execute(
                update(Event)
                .where(Event.id == registration.event_id)
                .values(checked_in_count=Event.checked_in_count + 1)
            )

            # 5. Create CheckIn record
            now = datetime.now(timezone.utc)
            checkin_record = CheckIn(
                registration_id=registration.id,
                station_id=station_id,
                checked_in_at=now,
            )
            db.session.add(checkin_record)

        # Commit the outer transaction (begin_nested created a savepoint;
        # we need an explicit commit to finalize)
        db.session.commit()

        # Refresh to get the generated id
        db.session.refresh(checkin_record)
        db.session.refresh(event)

        return (
            jsonify(
                {
                    "status": "checked_in",
                    "attendee": {
                        "id": registration.user_id,
                        "email": registration.user.email,
                    },
                    "event": event.to_dict(),
                    "checked_in_at": checkin_record.checked_in_at.isoformat(),
                    "station_id": checkin_record.station_id,
                    "checkin": checkin_record.to_dict(),
                }
            ),
            200,
        )

    except IntegrityError:
        # Belt-and-suspenders: UNIQUE constraint on registration_id fired.
        # This means a concurrent request somehow got past the FOR UPDATE lock.
        db.session.rollback()

        existing_checkin = db.session.execute(
            select(CheckIn).where(
                CheckIn.registration_id == registration.id
            )
        ).scalar_one_or_none()

        checked_in_at = (
            existing_checkin.checked_in_at.isoformat()
            if existing_checkin
            else None
        )
        return (
            jsonify(
                {
                    "error": "Already checked in",
                    "checked_in_at": checked_in_at,
                }
            ),
            409,
        )
