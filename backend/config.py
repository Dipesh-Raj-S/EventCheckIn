import os


class Config:
    """Base configuration."""

    SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-secret-key")
    SQLALCHEMY_DATABASE_URI = os.environ.get(
        "DATABASE_URL", "postgresql://postgres:postgres@db:5432/eventcheckin"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev-secret-key")
    # Token expiry
    JWT_ACCESS_TOKEN_EXPIRES = 3600  # 1 hour (in seconds, converted by flask-jwt-extended)
    JWT_REFRESH_TOKEN_EXPIRES = 2592000  # 30 days

    # Organizer signup gate — must match to register as organizer
    ORGANIZER_SIGNUP_CODE = os.environ.get("ORGANIZER_SIGNUP_CODE", "1309")


class DevelopmentConfig(Config):
    DEBUG = True


class ProductionConfig(Config):
    DEBUG = False


config_by_name = {
    "development": DevelopmentConfig,
    "production": ProductionConfig,
}
