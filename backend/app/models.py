import enum
from datetime import datetime, timezone

from werkzeug.security import generate_password_hash, check_password_hash

from app.extensions import db


class UserRole(str, enum.Enum):
    organizer = "organizer"
    attendee = "attendee"


class TokenStatus(str, enum.Enum):
    active = "active"
    used = "used"


class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(255), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)
    role = db.Column(db.Enum(UserRole), nullable=False)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    events = db.relationship("Event", back_populates="organizer", lazy="dynamic")
    registrations = db.relationship(
        "Registration", back_populates="user", lazy="dynamic"
    )

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    def to_dict(self):
        return {
            "id": self.id,
            "email": self.email,
            "role": self.role.value,
            "created_at": self.created_at.isoformat(),
        }


class Event(db.Model):
    __tablename__ = "events"

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(255), nullable=False)
    date = db.Column(db.DateTime(timezone=True), nullable=False)
    capacity = db.Column(db.Integer, nullable=False)
    registered_count = db.Column(db.Integer, default=0, nullable=False)
    checked_in_count = db.Column(db.Integer, default=0, nullable=False)
    organizer_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    organizer = db.relationship("User", back_populates="events")
    registrations = db.relationship(
        "Registration",
        back_populates="event",
        lazy="dynamic",
        cascade="all, delete-orphan",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "date": self.date.isoformat(),
            "capacity": self.capacity,
            "registered_count": self.registered_count,
            "checked_in_count": self.checked_in_count,
            "organizer_id": self.organizer_id,
            "created_at": self.created_at.isoformat(),
        }


class Registration(db.Model):
    __tablename__ = "registrations"
    __table_args__ = (
        db.UniqueConstraint("event_id", "user_id", name="uq_event_user"),
    )

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(
        db.Integer, db.ForeignKey("events.id"), nullable=False, index=True
    )
    user_id = db.Column(
        db.Integer, db.ForeignKey("users.id"), nullable=False, index=True
    )
    qr_token = db.Column(db.String(36), unique=True, nullable=False, index=True)
    token_status = db.Column(
        db.Enum(TokenStatus), default=TokenStatus.active, nullable=False
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    event = db.relationship("Event", back_populates="registrations")
    user = db.relationship("User", back_populates="registrations")
    checkin = db.relationship(
        "CheckIn", back_populates="registration", uselist=False
    )

    def to_dict(self):
        return {
            "id": self.id,
            "event_id": self.event_id,
            "user_id": self.user_id,
            "qr_token": self.qr_token,
            "token_status": self.token_status.value,
            "created_at": self.created_at.isoformat(),
        }


class CheckIn(db.Model):
    """
    Records a single check-in scan.

    One-to-one with Registration — the UNIQUE constraint on registration_id
    is the belt-and-suspenders safety net on top of the SELECT ... FOR UPDATE
    row lock in the check-in endpoint.
    """

    __tablename__ = "checkins"

    id = db.Column(db.Integer, primary_key=True)
    registration_id = db.Column(
        db.Integer,
        db.ForeignKey("registrations.id"),
        nullable=False,
        unique=True,
        index=True,
    )
    station_id = db.Column(db.String(100), nullable=False)
    checked_in_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # Relationships
    registration = db.relationship("Registration", back_populates="checkin")

    def to_dict(self):
        return {
            "id": self.id,
            "registration_id": self.registration_id,
            "station_id": self.station_id,
            "checked_in_at": self.checked_in_at.isoformat(),
        }
