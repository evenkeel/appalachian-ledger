"""The shared file's tables. Nothing here is anyone's money."""

from sqlalchemy import BigInteger, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from .db import SharedBase
from .models import now


class Person(SharedBase):
    __tablename__ = "people"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    # File name of this person's ledger, inside the data folder.
    ledger: Mapped[str] = mapped_column(String(200), unique=True)
    created_at: Mapped[str] = mapped_column(default=now)


class Session(SharedBase):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    person_id: Mapped[int] = mapped_column(ForeignKey("people.id"), index=True)
    csrf: Mapped[str]
    expires: Mapped[int] = mapped_column(BigInteger)


class LoginAttempt(SharedBase):
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    client: Mapped[str] = mapped_column(index=True)
    at: Mapped[int] = mapped_column(BigInteger)


class MarketDay(SharedBase):
    """A downloaded daily bitcoin price. Fetched once, then copied into each ledger that needs it."""

    __tablename__ = "market_days"
    source: Mapped[str] = mapped_column(primary_key=True)
    method: Mapped[str] = mapped_column(primary_key=True)
    day: Mapped[str] = mapped_column(primary_key=True)
    usd_per_btc: Mapped[str] = mapped_column(String(80))
    observed_at: Mapped[str]
    fetched_at: Mapped[str] = mapped_column(default=now)


class MarketQuote(SharedBase):
    """The latest downloaded live quote from one source."""

    __tablename__ = "market_quotes"
    source: Mapped[str] = mapped_column(primary_key=True)
    usd_per_btc: Mapped[str] = mapped_column(String(80))
    observed_at: Mapped[str]
    fetched_at: Mapped[str]
