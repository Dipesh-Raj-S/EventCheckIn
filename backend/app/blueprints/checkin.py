"""
Check-in endpoints — live scan and offline batch sync.

CONFLICT POLICY (plain language):
  Server-arrival-order wins over device-scan-time.

  When two stations (or the same station offline then online) both scan the
  same QR code, the first scan to *reach the server and commit* is the
  canonical check-in. The losing scan is logged as a CheckInConflict row —
  never silently dropped — so the organizer can review it.

  Rationale: retroactively undoing an already-confirmed check-in (e.g.
  "actually Station B scanned 30 seconds earlier on the device clock")
  is operationally worse than a logged, reviewable conflict. Device clocks
  can drift; the database transaction is the source of truth.

Transactional pattern (shared by live + sync paths):
  1. SELECT ... FOR UPDATE on Registration (row lock)
  2. If already used → conflict (409 for live, logged for sync)
  3. Flip token_status to "used"
  4. Atomic UPDATE Event.checked_in_count + 1
  5. Insert CheckIn row (with client_scan_id)
  All in one transaction — commits on success, rolls back on failure.
"""

from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.decorators import role_required
from app.extensions import db, socketio, limiter
from app.models import CheckIn, CheckInConflict, Event, Registration, TokenStatus

checkin_bp = Blueprint("checkin", __name__)


# ---------------------------------------------------------------------------
# Shared transactional check-in logic
# ---------------------------------------------------------------------------

def _process_checkin(qr_token, station_id, organizer_id, client_scan_id=None,
                     device_scanned_at=None):
    """
    Execute the core check-in transaction.

    Returns a dict with:
      {"ok": True, "checkin": CheckIn, "registration": Registration, "event": Event}
    or
      {"ok": False, "reason": str, "status_code": int, "detail": dict}

    This function must be called inside an active session (no standalone
    commit — the caller decides when to commit/rollback).
    """

    # --- Idempotent retry: if this client_scan_id was already processed,
    # return the original result without re-processing. ---
    if client_scan_id:
        existing = db.session.execute(
            select(CheckIn).where(CheckIn.client_scan_id == client_scan_id)
        ).scalar_one_or_none()
        if existing:
            reg = db.session.get(Registration, existing.registration_id)
            evt = db.session.get(Event, reg.event_id)
            return {
                "ok": True,
                "checkin": existing,
                "registration": reg,
                "event": evt,
                "already_synced": True,
            }

    # --- 1. Lock the registration row ---
    registration = db.session.execute(
        select(Registration)
        .where(Registration.qr_token == qr_token)
        .with_for_update()
    ).scalar_one_or_none()

    if registration is None:
        return {
            "ok": False,
            "reason": "invalid_qr",
            "status_code": 404,
            "detail": {"status": "invalid"},
        }

    # --- Authorization: organizer must own the event ---
    event = db.session.get(Event, registration.event_id)
    if event.organizer_id != organizer_id:
        return {
            "ok": False,
            "reason": "forbidden",
            "status_code": 403,
            "detail": {
                "error": "Forbidden: you can only check in attendees for your own events"
            },
        }

    # --- 2. Already checked in? ---
    if registration.token_status == TokenStatus.used:
        existing_checkin = db.session.execute(
            select(CheckIn).where(
                CheckIn.registration_id == registration.id
            )
        ).scalar_one_or_none()

        return {
            "ok": False,
            "reason": "already_checked_in",
            "status_code": 409,
            "detail": {
                "status": "conflict",
                "attendee": {
                    "email": registration.user.email
                },
                "original_checkin": {
                    "checked_in_at": existing_checkin.checked_in_at.isoformat() if existing_checkin else None,
                    "station_id": existing_checkin.station_id if existing_checkin else None
                }
            },
            "registration": registration,
            "event": event,
            "existing_checkin": existing_checkin
        }

    # --- 3. Flip token status ---
    registration.token_status = TokenStatus.used

    # --- 4. Atomic increment of checked_in_count ---
    db.session.execute(
        update(Event)
        .where(Event.id == registration.event_id)
        .values(checked_in_count=Event.checked_in_count + 1)
    )

    # --- 5. Create CheckIn record ---
    now = datetime.now(timezone.utc)
    checkin_record = CheckIn(
        registration_id=registration.id,
        client_scan_id=client_scan_id,
        station_id=station_id,
        checked_in_at=now,
    )
    db.session.add(checkin_record)

    return {
        "ok": True,
        "checkin": checkin_record,
        "registration": registration,
        "event": event,
        "already_synced": False,
    }


def _success_response(result):
    """Build the standard success JSON from a _process_checkin result."""
    reg = result["registration"]
    ci = result["checkin"]
    return {
        "status": "success",
        "attendee": {
            "email": reg.user.email,
        },
        "checked_in_at": ci.checked_in_at.isoformat(),
        "station_id": ci.station_id,
    }


# ---------------------------------------------------------------------------
# POST /api/checkin — live scan
# ---------------------------------------------------------------------------

@checkin_bp.route("/api/checkin", methods=["POST"])
@limiter.limit("60 per minute")
@role_required("organizer")
def checkin():
    """
    Scan a QR token to check in an attendee (live path).

    Body: { "qr_token": str, "station_id": str, "client_scan_id"?: str }
    Access: organizer only, organizer must own the event.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    qr_token = data.get("qr_token", "").strip()
    station_id = data.get("station_id", "").strip()
    client_scan_id = data.get("client_scan_id", "").strip() or None

    if not qr_token:
        return jsonify({"error": "qr_token is required"}), 400
    if not station_id:
        return jsonify({"error": "station_id is required"}), 400

    identity = int(get_jwt_identity())

    try:
        with db.session.begin_nested():
            result = _process_checkin(
                qr_token, station_id, identity, client_scan_id
            )

            if not result["ok"]:
                return jsonify(result["detail"]), result["status_code"]

        db.session.commit()

        # Refresh to get generated ids
        db.session.refresh(result["checkin"])
        db.session.refresh(result["event"])
        
        # Emit WebSocket update for live dashboard
        socketio.emit("checkin_update", {
            "event_id": result["event"].id,
            "checked_in_count": result["event"].checked_in_count,
            "checkin": {
                "registration_id": result["registration"].id,
                "attendee": {
                    "name": result["registration"].user.email, # Fallback to email as name is not in schema
                    "email": result["registration"].user.email
                },
                "station_id": result["checkin"].station_id,
                "checked_in_at": result["checkin"].checked_in_at.isoformat()
            }
        }, room=f"event_{result['event'].id}")

        return jsonify(_success_response(result)), 200

    except IntegrityError:
        db.session.rollback()

        # Belt-and-suspenders: UNIQUE constraint on registration_id fired
        if client_scan_id:
            existing = db.session.execute(
                select(CheckIn).where(
                    CheckIn.client_scan_id == client_scan_id
                )
            ).scalar_one_or_none()
            if existing:
                reg = db.session.get(Registration, existing.registration_id)
                evt = db.session.get(Event, reg.event_id)
                return jsonify(_success_response({
                    "checkin": existing,
                    "registration": reg,
                    "event": evt,
                })), 200

        return (
            jsonify({"status": "conflict", "attendee": {"email": ""}, "original_checkin": {"checked_in_at": None, "station_id": None}}),
            409,
        )


# ---------------------------------------------------------------------------
# POST /api/checkin/sync — offline batch sync
# ---------------------------------------------------------------------------

@checkin_bp.route("/api/checkin/sync", methods=["POST"])
@limiter.limit("30 per minute")
@role_required("organizer")
def checkin_sync():
    """
    Sync a batch of offline-queued scans.

    Body: {
      "scans": [
        { "client_scan_id": str, "qr_token": str, "station_id": str,
          "device_scanned_at"?: str (ISO datetime) },
        ...
      ]
    }

    Returns 200 with per-item results regardless of individual conflicts.
    A conflict is an expected, handled outcome — not a failure.
    """
    data = request.get_json()
    if not data or "scans" not in data:
        return jsonify({"error": "Missing 'scans' array in body"}), 400

    scans = data["scans"]
    if not isinstance(scans, list):
        return jsonify({"error": "'scans' must be an array"}), 400
    if len(scans) > 200:
        return jsonify({"error": "Payload size limit exceeded: maximum 200 scans per sync request"}), 400

    identity = int(get_jwt_identity())
    results = []

    for scan in scans:
        client_scan_id = scan.get("client_scan_id", "").strip() or None
        qr_token = scan.get("qr_token", "").strip()
        station_id = scan.get("station_id", "").strip()
        device_scanned_at_str = scan.get("device_scanned_at")

        # Parse device_scanned_at if provided
        device_scanned_at = None
        if device_scanned_at_str:
            try:
                device_scanned_at = datetime.fromisoformat(
                    device_scanned_at_str
                )
            except (ValueError, TypeError):
                pass

        if not qr_token or not station_id:
            results.append({
                "client_scan_id": client_scan_id,
                "status": "error",
                "error": "qr_token and station_id are required",
            })
            continue

        try:
            with db.session.begin_nested():
                result = _process_checkin(
                    qr_token, station_id, identity, client_scan_id,
                    device_scanned_at
                )

                if result["ok"]:
                    status = (
                        "already_synced" if result.get("already_synced")
                        else "synced"
                    )
                elif result["reason"] == "already_checked_in":
                    # Log the conflict — don't raise an error
                    conflict = CheckInConflict(
                        registration_id=result["registration"].id,
                        client_scan_id=client_scan_id,
                        station_id=station_id,
                        device_scanned_at=device_scanned_at,
                        reason="already_checked_in",
                    )
                    db.session.add(conflict)

                    db.session.commit()

                    results.append({
                        "client_scan_id": client_scan_id,
                        "status": "conflict",
                        "attendee": {
                            "email": result["registration"].user.email
                        },
                        "original_checkin": {
                            "station_id": result["detail"]["original_checkin"]["station_id"],
                            "checked_in_at": result["detail"]["original_checkin"]["checked_in_at"],
                        },
                    })
                    continue
                else:
                    # invalid_qr, forbidden, etc.
                    results.append({
                        "client_scan_id": client_scan_id,
                        "status": result["detail"].get("status", "error"),
                        "error": result["detail"].get("error", "Unknown error"),
                    })
                    continue

            db.session.commit()

            ci = result["checkin"]
            db.session.refresh(ci)
            db.session.refresh(result["event"])
            
            if status == "synced":
                # Emit WebSocket update for live dashboard
                socketio.emit("checkin_update", {
                    "event_id": result["event"].id,
                    "checked_in_count": result["event"].checked_in_count,
                    "checkin": {
                        "registration_id": result["registration"].id,
                        "attendee": {
                            "name": result["registration"].user.email,
                            "email": result["registration"].user.email
                        },
                        "station_id": ci.station_id,
                        "checked_in_at": ci.checked_in_at.isoformat()
                    }
                }, room=f"event_{result['event'].id}")

            results.append({
                "client_scan_id": client_scan_id,
                "status": status,
                "attendee": {
                    "email": result["registration"].user.email
                },
                "checked_in_at": ci.checked_in_at.isoformat(),
                "station_id": ci.station_id
            })

        except IntegrityError:
            db.session.rollback()
            # Same client_scan_id already exists — treat as already_synced
            if client_scan_id:
                existing = db.session.execute(
                    select(CheckIn).where(
                        CheckIn.client_scan_id == client_scan_id
                    )
                ).scalar_one_or_none()
                if existing:
                    results.append({
                        "client_scan_id": client_scan_id,
                        "status": "already_synced",
                        "attendee": {
                            "email": existing.registration.user.email
                        },
                        "checked_in_at": existing.checked_in_at.isoformat(),
                        "station_id": existing.station_id
                    })
                    continue

            results.append({
                "client_scan_id": client_scan_id,
                "status": "error",
                "error": "Database conflict",
            })

    return jsonify({"results": results}), 200


# ---------------------------------------------------------------------------
# GET /api/events/<id>/conflicts — organizer conflict audit log
# ---------------------------------------------------------------------------

@checkin_bp.route("/api/events/<int:event_id>/conflicts", methods=["GET"])
@role_required("organizer")
def event_conflicts(event_id):
    """
    List check-in conflicts for an event.
    Organizer only, owner only.
    """
    identity = int(get_jwt_identity())
    event = Event.query.get(event_id)

    if not event:
        return jsonify({"error": "Event not found"}), 404

    if event.organizer_id != identity:
        return (
            jsonify(
                {
                    "error": "Forbidden: you can only view conflicts for your own events"
                }
            ),
            403,
        )

    # Join through Registration to find conflicts for this event's registrations
    conflicts = (
        db.session.query(CheckInConflict)
        .join(Registration, CheckInConflict.registration_id == Registration.id)
        .filter(Registration.event_id == event_id)
        .order_by(CheckInConflict.attempted_sync_at.desc())
        .all()
    )

    result = []
    for conflict in conflicts:
        d = conflict.to_dict()
        d["attendee_email"] = conflict.registration.user.email
        result.append(d)

    return jsonify({"conflicts": result}), 200
