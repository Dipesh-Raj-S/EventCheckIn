import json
import logging
import os

from flask import Blueprint, request, jsonify
from flask_jwt_extended import get_jwt_identity
from sqlalchemy import func

from app.decorators import role_required
from app.extensions import db
from app.models import Event, Registration, CheckIn, User

insights_bp = Blueprint("insights", __name__, url_prefix="/api/events")
logger = logging.getLogger(__name__)

# The current recommended fast model from google-genai SDK docs (PyPI v2.19.0)
GEMINI_MODEL = "gemini-3.6-flash"


def _compute_stats(event_id, event):
    """
    Compute all event statistics from the database.
    This is the ONLY data the AI will see — it must be accurate.
    """
    checked_in_count = event.checked_in_count or 0
    registered_count = event.registered_count or 0
    capacity = event.capacity or 0
    spots_left = max(0, capacity - registered_count)

    no_show_percentage = (
        round(((registered_count - checked_in_count) / registered_count) * 100, 1)
        if registered_count > 0
        else 0
    )

    # Earliest and latest check-in timestamps
    earliest_checkin = (
        db.session.query(func.min(CheckIn.checked_in_at))
        .join(Registration, CheckIn.registration_id == Registration.id)
        .filter(Registration.event_id == event_id)
        .scalar()
    )
    latest_checkin = (
        db.session.query(func.max(CheckIn.checked_in_at))
        .join(Registration, CheckIn.registration_id == Registration.id)
        .filter(Registration.event_id == event_id)
        .scalar()
    )

    # Peak check-in time — GROUP BY 10-minute buckets
    # date_trunc to 10-min: truncate to hour then add floor(minute/10)*10 minutes
    # Use a simpler approach: extract hour and 10-min bucket
    peak_time_result = (
        db.session.query(
            func.date_trunc('hour', CheckIn.checked_in_at).label('hour_bucket'),
            (func.extract('minute', CheckIn.checked_in_at) / 10).cast(db.Integer).label('ten_min'),
            func.count().label('cnt'),
        )
        .join(Registration, CheckIn.registration_id == Registration.id)
        .filter(Registration.event_id == event_id)
        .group_by('hour_bucket', 'ten_min')
        .order_by(func.count().desc())
        .first()
    )

    peak_checkin_time = None
    if peak_time_result and peak_time_result.hour_bucket:
        from datetime import timedelta
        hour_base = peak_time_result.hour_bucket
        ten_min = peak_time_result.ten_min or 0
        bucket_start = hour_base + timedelta(minutes=ten_min * 10)
        bucket_end = bucket_start + timedelta(minutes=10)
        peak_checkin_time = (
            f"{bucket_start.strftime('%I:%M %p')} – {bucket_end.strftime('%I:%M %p')}"
        )

    # Count by station
    station_counts = (
        db.session.query(CheckIn.station_id, func.count().label('cnt'))
        .join(Registration, CheckIn.registration_id == Registration.id)
        .filter(Registration.event_id == event_id)
        .group_by(CheckIn.station_id)
        .all()
    )
    checkins_by_station = {row.station_id: row.cnt for row in station_counts}

    return {
        "event_name": event.name,
        "event_date": event.date.isoformat() if event.date else None,
        "capacity": capacity,
        "registered_count": registered_count,
        "checked_in_count": checked_in_count,
        "spots_left": spots_left,
        "no_show_percentage": no_show_percentage,
        "peak_checkin_time": peak_checkin_time,
        "earliest_checkin": earliest_checkin.isoformat() if earliest_checkin else None,
        "latest_checkin": latest_checkin.isoformat() if latest_checkin else None,
        "checkins_by_station": checkins_by_station,
    }


@insights_bp.route("/<int:event_id>/insights", methods=["POST"])
@role_required("organizer")
def event_insights(event_id):
    """
    AI-powered insights for an event. Organizer only, owner only.
    Body: { "question": "..." }
    """
    identity = int(get_jwt_identity())
    event = Event.query.get(event_id)

    if not event:
        return jsonify({"error": "Event not found"}), 404

    if event.organizer_id != identity:
        return (
            jsonify({"error": "Forbidden: you can only view insights for your own events"}),
            403,
        )

    data = request.get_json()
    if not data or not data.get("question", "").strip():
        return jsonify({"error": "question is required"}), 400

    question = data["question"].strip()

    # Step 1: Compute real stats from the DB — this ALWAYS succeeds independently of AI
    stats = _compute_stats(event_id, event)

    # Step 2: Attempt to call Gemini API
    gemini_api_key = os.environ.get("GEMINI_API_KEY", "").strip()

    if not gemini_api_key:
        logger.warning("GEMINI_API_KEY is not set — returning stats-only fallback")
        return jsonify({"answer": None, "stats": stats, "ai_error": True}), 200

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(
            api_key=gemini_api_key,
            http_options=types.HttpOptions(timeout=10_000),  # 10s timeout in ms
        )

        prompt = f"""You are an assistant summarizing live event check-in \
statistics for an event organizer. Below is the current, accurate data for \
this event. Answer the organizer's question using ONLY this data. Do not \
invent, estimate, or guess any number not present in the data below. If the \
data doesn't contain what's needed to answer, say so plainly instead of \
guessing. Keep your answer concise and conversational — 2-3 sentences max.

EVENT DATA:
{json.dumps(stats, indent=2)}

ORGANIZER QUESTION: {question}"""

        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=300,
            ),
        )

        answer_text = response.text
        return jsonify({"answer": answer_text, "stats": stats}), 200

    except Exception as e:
        logger.error(f"Gemini API call failed: {type(e).__name__}: {e}")
        return jsonify({"answer": None, "stats": stats, "ai_error": True}), 200
