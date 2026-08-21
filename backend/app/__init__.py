import os
from datetime import timedelta

from flask import Flask

from config import config_by_name


def create_app(config_name=None):
    """Flask application factory."""
    if config_name is None:
        config_name = os.environ.get("FLASK_ENV", "development")

    app = Flask(__name__)
    app.config.from_object(config_by_name[config_name])

    # Convert token expiry from seconds to timedelta for flask-jwt-extended
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(
        seconds=app.config.get("JWT_ACCESS_TOKEN_EXPIRES", 3600)
    )
    app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(
        seconds=app.config.get("JWT_REFRESH_TOKEN_EXPIRES", 2592000)
    )

    # Initialize extensions
    from app.extensions import cors, db, jwt, migrate, socketio, limiter

    # Configure limiter storage from environment before initializing
    storage_uri = app.config.get("RATELIMIT_STORAGE_URI") or os.environ.get("RATELIMIT_STORAGE_URI", "redis://localhost:6379/0")
    # Must use app.config since limiter.init_app relies on RATELIMIT_STORAGE_URI
    app.config["RATELIMIT_STORAGE_URI"] = storage_uri


    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    cors.init_app(app, resources={r"/api/*": {"origins": "*"}})
    socketio.init_app(app)
    limiter.init_app(app)

    # Register rate limit error handler
    from flask import jsonify
    from flask_limiter.errors import RateLimitExceeded
    
    @app.errorhandler(RateLimitExceeded)
    def handle_rate_limit_exceeded(e):
        return jsonify({ "error": "Too many requests, please slow down and try again shortly." }), 429

    # Import socket events
    from app import sockets  # noqa: F401

    # Import models so Flask-Migrate can detect them
    from app import models  # noqa: F401

    # Register blueprints
    from app.blueprints.auth import auth_bp
    from app.blueprints.checkin import checkin_bp
    from app.blueprints.events import events_bp
    from app.blueprints.insights import insights_bp
    from app.blueprints.registrations import registrations_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(checkin_bp)
    app.register_blueprint(events_bp)
    app.register_blueprint(insights_bp)
    app.register_blueprint(registrations_bp)

    # Health check endpoint
    @app.route("/api/health")
    def health():
        return {"status": "ok"}

    return app
