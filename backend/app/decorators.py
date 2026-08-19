from functools import wraps

from flask import jsonify
from flask_jwt_extended import get_jwt, verify_jwt_in_request


def role_required(required_role):
    """
    Decorator that enforces role-based access control via JWT claims.

    Reads the 'role' claim embedded in the JWT at login time — does NOT
    perform a DB lookup on every request, for speed.

    Usage:
        @role_required("organizer")
        def create_event():
            ...
    """

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            claims = get_jwt()
            token_role = claims.get("role")

            if token_role != required_role:
                return (
                    jsonify(
                        {
                            "error": "Forbidden",
                            "message": f"This endpoint requires the '{required_role}' role. "
                            f"Your role is '{token_role}'.",
                        }
                    ),
                    403,
                )

            return fn(*args, **kwargs)

        return wrapper

    return decorator
