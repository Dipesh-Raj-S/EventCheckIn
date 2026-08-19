from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity, jwt_required

from app.decorators import role_required
from app.extensions import db
from app.models import Event

events_bp = Blueprint("events", __name__, url_prefix="/api/events")


@events_bp.route("", methods=["POST"])
@role_required("organizer")
def create_event():
    """Create a new event. Organizer only."""
    data = request.get_json()

    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    name = data.get("name", "").strip()
    date = data.get("date")
    capacity = data.get("capacity")

    if not name or not date or capacity is None:
        return jsonify({"error": "name, date, and capacity are required"}), 400

    try:
        capacity = int(capacity)
        if capacity < 1:
            raise ValueError()
    except (ValueError, TypeError):
        return jsonify({"error": "capacity must be a positive integer"}), 400

    from datetime import datetime

    try:
        parsed_date = datetime.fromisoformat(date)
    except (ValueError, TypeError):
        return jsonify({"error": "date must be a valid ISO 8601 datetime string"}), 400

    identity = get_jwt_identity()
    event = Event(
        name=name,
        date=parsed_date,
        capacity=capacity,
        organizer_id=int(identity),
    )

    db.session.add(event)
    db.session.commit()

    return jsonify({"message": "Event created", "event": event.to_dict()}), 201


@events_bp.route("", methods=["GET"])
@jwt_required()
def list_events():
    """List all events. Any authenticated user."""
    events = Event.query.order_by(Event.date.desc()).all()
    return jsonify({"events": [e.to_dict() for e in events]}), 200


@events_bp.route("/<int:event_id>", methods=["GET"])
@jwt_required()
def get_event(event_id):
    """Get a single event by ID. Any authenticated user."""
    event = Event.query.get(event_id)

    if not event:
        return jsonify({"error": "Event not found"}), 404

    return jsonify({"event": event.to_dict()}), 200


@events_bp.route("/<int:event_id>", methods=["PATCH"])
@role_required("organizer")
def update_event(event_id):
    """Update an event. Organizer only, owner only."""
    identity = get_jwt_identity()
    event = Event.query.get(event_id)

    if not event:
        return jsonify({"error": "Event not found"}), 404

    if event.organizer_id != int(identity):
        return (
            jsonify({"error": "Forbidden: you can only edit your own events"}),
            403,
        )

    data = request.get_json()
    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    if "name" in data:
        event.name = data["name"].strip()

    if "date" in data:
        from datetime import datetime

        try:
            event.date = datetime.fromisoformat(data["date"])
        except (ValueError, TypeError):
            return (
                jsonify({"error": "date must be a valid ISO 8601 datetime string"}),
                400,
            )

    if "capacity" in data:
        try:
            cap = int(data["capacity"])
            if cap < 1:
                raise ValueError()
            event.capacity = cap
        except (ValueError, TypeError):
            return jsonify({"error": "capacity must be a positive integer"}), 400

    db.session.commit()

    return jsonify({"message": "Event updated", "event": event.to_dict()}), 200


@events_bp.route("/<int:event_id>", methods=["DELETE"])
@role_required("organizer")
def delete_event(event_id):
    """Delete an event. Organizer only, owner only."""
    identity = get_jwt_identity()
    event = Event.query.get(event_id)

    if not event:
        return jsonify({"error": "Event not found"}), 404

    if event.organizer_id != int(identity):
        return (
            jsonify({"error": "Forbidden: you can only delete your own events"}),
            403,
        )

    db.session.delete(event)
    db.session.commit()

    return jsonify({"message": "Event deleted"}), 200
