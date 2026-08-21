from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    get_jwt,
    get_jwt_identity,
    jwt_required,
)

from app.extensions import db, limiter
from app.models import User, UserRole

auth_bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@auth_bp.route("/register", methods=["POST"])
@limiter.limit("5 per minute") # Also guards against organizer code brute-forcing
def register():
    """Register a new user with email, password, and role."""
    data = request.get_json()

    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")
    role = data.get("role", "")

    # Validation
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    if not email.endswith("@vitstudent.ac.in"):
        return jsonify({"error": "Please use your VIT student email (@vitstudent.ac.in)"}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    if role not in [r.value for r in UserRole]:
        return (
            jsonify(
                {"error": f"Invalid role. Must be one of: {[r.value for r in UserRole]}"}
            ),
            400,
        )

    club = None
    if role == "organizer":
        from app.constants import CLUBS
        club = data.get("club", "").strip()
        if not club or club not in CLUBS:
            return jsonify({"error": f"Invalid club. Must be one of the recognized clubs."}), 400

        organizer_code = data.get("organizer_code", "")
        expected_code = current_app.config["ORGANIZER_SIGNUP_CODE"]
        if str(organizer_code) != str(expected_code):
            return jsonify({"error": "Invalid organizer code"}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "A user with this email already exists"}), 409

    user = User(email=email, role=UserRole(role), club=club)
    user.set_password(password)

    db.session.add(user)
    db.session.commit()

    return jsonify({"message": "User registered successfully", "user": user.to_dict()}), 201


@auth_bp.route("/clubs", methods=["GET"])
def get_clubs():
    """Return the list of valid clubs."""
    from app.constants import CLUBS
    return jsonify({"clubs": CLUBS}), 200


@auth_bp.route("/login", methods=["POST"])
@limiter.limit("10 per minute")
def login():
    """Authenticate user and return access + refresh tokens with role claim."""
    data = request.get_json()

    if not data:
        return jsonify({"error": "Missing JSON body"}), 400

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = User.query.filter_by(email=email).first()

    if not user or not user.check_password(password):
        return jsonify({"error": "Invalid email or password"}), 401

    # Embed the role as an additional JWT claim — validated at login time,
    # so subsequent requests can read it from the token without a DB lookup.
    additional_claims = {"role": user.role.value}

    access_token = create_access_token(
        identity=str(user.id), additional_claims=additional_claims
    )
    refresh_token = create_refresh_token(
        identity=str(user.id), additional_claims=additional_claims
    )

    return (
        jsonify(
            {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "user": user.to_dict(),
            }
        ),
        200,
    )


@auth_bp.route("/refresh", methods=["POST"])
@jwt_required(refresh=True)
def refresh():
    """Issue a new access token from a valid refresh token, preserving the role claim."""
    identity = get_jwt_identity()
    claims = get_jwt()
    role = claims.get("role")

    access_token = create_access_token(
        identity=identity, additional_claims={"role": role}
    )

    return jsonify({"access_token": access_token}), 200


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    """Return current user info from JWT identity."""
    identity = get_jwt_identity()
    user = User.query.get(int(identity))

    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify({"user": user.to_dict()}), 200
