from flask_socketio import join_room, emit
from flask_jwt_extended import decode_token
from flask_jwt_extended.exceptions import JWTExtendedException

from app.extensions import socketio, db
from app.models import Event, UserRole

@socketio.on('join_event_dashboard')
def handle_join_event_dashboard(data):
    """
    Authenticate and authorize user to join an event's live dashboard room.
    data: { "event_id": int, "token": str }
    """
    try:
        if not isinstance(data, dict):
            emit('error', {'message': 'Invalid data format'})
            return

        event_id = data.get('event_id')
        token = data.get('token')

        if not event_id or not token:
            emit('error', {'message': 'event_id and token are required'})
            return

        try:
            # Decode the token (verifies signature and expiration automatically)
            decoded = decode_token(token)
        except JWTExtendedException as e:
            emit('error', {'message': f'Invalid token: {str(e)}'})
            return

        user_id = int(decoded.get('sub'))
        role = decoded.get('role')

        if role != UserRole.organizer.value:
            emit('error', {'message': 'Forbidden: organizers only'})
            return

        # Verify event ownership
        event = db.session.get(Event, event_id)
        if not event:
            emit('error', {'message': 'Event not found'})
            return

        if event.organizer_id != user_id:
            emit('error', {'message': 'Forbidden: you do not own this event'})
            return

        # All checks passed, join the room
        room_name = f"event_{event_id}"
        join_room(room_name)
        emit('joined', {'room': room_name})
    except Exception as e:
        emit('error', {'message': f'Internal server error: {str(e)}'})

