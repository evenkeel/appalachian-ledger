from datetime import datetime, timezone
from sqlalchemy import BigInteger, Boolean, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column
from .db import Base


def now():
    return datetime.now(timezone.utc).isoformat()


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    preferences: Mapped[str] = mapped_column(Text, default="{}")
    demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(default=now)


class Session(Base):
    __tablename__ = "sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    csrf: Mapped[str]
    expires: Mapped[int] = mapped_column(BigInteger)


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(primary_key=True)
    client: Mapped[str] = mapped_column(index=True)
    at: Mapped[int] = mapped_column(BigInteger)


class Account(Base):
    __tablename__ = "accounts"
    __table_args__ = (
        CheckConstraint("currency IN ('USD','BITCOIN')"),
        CheckConstraint("role IN ('asset','liability','income','expense','equity','clearing')"),
    )
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    kind: Mapped[str]
    role: Mapped[str]
    currency: Mapped[str]
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    internal: Mapped[bool] = mapped_column(Boolean, default=False)
    exclude_from_liquid_usd: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    exclude_from_consumer_debt: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    created_at: Mapped[str] = mapped_column(default=now)


class Category(Base):
    __tablename__ = "categories"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    kind: Mapped[str]
    spending_type: Mapped[str] = mapped_column(default="unclassified", server_default="unclassified")
    __table_args__ = (CheckConstraint("kind IN ('income','expense')"),)


class ExchangeRate(Base):
    __tablename__ = "exchange_rates"
    __table_args__ = (Index("ix_rates_source_day_method", "source", "day", "method"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    day: Mapped[str] = mapped_column(index=True)
    usd_per_btc: Mapped[str] = mapped_column(String(80))
    source: Mapped[str]
    fetched_at: Mapped[str] = mapped_column(default=now)
    observed_at: Mapped[str | None]
    method: Mapped[str] = mapped_column(default="legacy", server_default="legacy")


class PriceQuote(Base):
    """Current market quote cache; never used as a historical daily close."""

    __tablename__ = "price_quotes"
    source: Mapped[str] = mapped_column(primary_key=True)
    usd_per_btc: Mapped[str]
    observed_at: Mapped[str]
    fetched_at: Mapped[str] = mapped_column(default=now)

    @property
    def day(self):
        return self.observed_at[:10]


class PriceSync(Base):
    __tablename__ = "price_sync"
    source: Mapped[str] = mapped_column(primary_key=True)
    start_day: Mapped[str | None]
    end_day: Mapped[str | None]
    next_day: Mapped[str | None]
    status: Mapped[str] = mapped_column(default="idle")
    error: Mapped[str | None]
    quote_error: Mapped[str | None]
    quote_attempt_at: Mapped[str | None]
    history_attempt_at: Mapped[str | None]
    last_success_at: Mapped[str | None]
    scheduled_day: Mapped[str | None]
    generation: Mapped[int] = mapped_column(default=0)
    quote_requested: Mapped[bool] = mapped_column(Boolean, default=False)


class ConversionAttachment(Base):
    """Append-only completion of a missing journal conversion, not a posting edit."""

    __tablename__ = "conversion_attachments"
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"), primary_key=True)
    rate_id: Mapped[int] = mapped_column(ForeignKey("exchange_rates.id"))
    created_at: Mapped[str] = mapped_column(default=now)


class JournalEntry(Base):
    __tablename__ = "journal_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[str] = mapped_column(index=True)
    kind: Mapped[str]
    description: Mapped[str] = mapped_column(String(500))
    notes: Mapped[str] = mapped_column(Text, default="")
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    destination_id: Mapped[int | None] = mapped_column(ForeignKey("accounts.id"))
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"))
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    destination_minor: Mapped[int | None] = mapped_column(BigInteger)
    rate_id: Mapped[int | None] = mapped_column(ForeignKey("exchange_rates.id"))
    # Snapshot values never change, even if another rate is entered for that date.
    rate_snapshot: Mapped[str | None]
    status: Mapped[str] = mapped_column(default="draft")
    reverses_id: Mapped[int | None] = mapped_column(ForeignKey("journal_entries.id"), unique=True)
    replaces_id: Mapped[int | None] = mapped_column(ForeignKey("journal_entries.id"))
    import_key: Mapped[str | None] = mapped_column(unique=True)
    created_at: Mapped[str] = mapped_column(default=now)
    __table_args__ = (
        CheckConstraint("status IN ('draft','posted')"),
        CheckConstraint("kind IN ('income','expense','transfer','opening','adjustment','valuation','reversal')"),
    )


class Posting(Base):
    __tablename__ = "postings"
    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"), index=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), index=True)
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    __table_args__ = (CheckConstraint("typeof(amount_minor) = 'integer'"),)


class Asset(Base):
    __tablename__ = "assets"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), unique=True)
    name: Mapped[str]
    kind: Mapped[str]
    quantity: Mapped[str] = mapped_column(default="1")


class AssetPrice(Base):
    __tablename__ = "asset_prices"
    id: Mapped[int] = mapped_column(primary_key=True)
    asset_id: Mapped[int] = mapped_column(ForeignKey("assets.id"), index=True)
    date: Mapped[str]
    value_minor: Mapped[int] = mapped_column(BigInteger)
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"), unique=True)
    created_at: Mapped[str] = mapped_column(default=now)
    __table_args__ = (UniqueConstraint("asset_id", "date"), CheckConstraint("value_minor >= 0"))


class Budget(Base):
    __tablename__ = "budgets"
    id: Mapped[int] = mapped_column(primary_key=True)
    month: Mapped[str] = mapped_column(index=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    amount_minor: Mapped[int] = mapped_column(BigInteger)
    currency: Mapped[str] = mapped_column(default="USD")
    scope: Mapped[str] = mapped_column(default="native")
    __table_args__ = (
        UniqueConstraint("month", "category_id", "currency"),
        CheckConstraint("amount_minor > 0 AND typeof(amount_minor) = 'integer'"),
        CheckConstraint("currency IN ('USD', 'BITCOIN')"),
        CheckConstraint("scope IN ('native', 'all')"),
    )


class WalletConnection(Base):
    __tablename__ = "wallet_connections"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), unique=True)
    wallet: Mapped[str] = mapped_column(unique=True)
    # Host and credentials are environment-only; no secrets in the database.
    last_checked: Mapped[str | None]


class ImportJob(Base):
    __tablename__ = "import_jobs"
    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str]
    imported: Mapped[int] = mapped_column(Integer)
    duplicates: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[str] = mapped_column(default=now)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    action: Mapped[str]
    entity: Mapped[str]
    detail: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(default=now)


class Portfolio(Base):
    __tablename__ = "portfolios"
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"), primary_key=True)
    started_on: Mapped[str]
    attempted_at: Mapped[str | None]
    error: Mapped[str | None]


class Holding(Base):
    __tablename__ = "holdings"
    account_id: Mapped[int] = mapped_column(ForeignKey("portfolios.account_id"), primary_key=True)
    symbol: Mapped[str] = mapped_column(primary_key=True)
    shares: Mapped[str]
    cost_minor: Mapped[int | None] = mapped_column(BigInteger)
    marked_minor: Mapped[int] = mapped_column(BigInteger)
    quote_snapshot: Mapped[str] = mapped_column(Text, default="{}", server_default="{}")


class StockQuote(Base):
    __tablename__ = "stock_quotes"
    symbol: Mapped[str] = mapped_column(primary_key=True)
    price: Mapped[str]
    previous_close: Mapped[str]
    observed_at: Mapped[str]
    fetched_at: Mapped[str]


class RecurringBill(Base):
    __tablename__ = "recurring_bills"
    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id"))
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"))
    description: Mapped[str] = mapped_column(String(500))
    notes: Mapped[str] = mapped_column(Text, default="")
    amount: Mapped[str] = mapped_column(String(80))
    frequency: Mapped[str] = mapped_column(String(10))
    next_due: Mapped[str] = mapped_column(String(10))
    anchor_day: Mapped[int]
    anchor_month: Mapped[int]
    archived: Mapped[bool] = mapped_column(Boolean, default=False)


class BillOccurrence(Base):
    __tablename__ = "bill_occurrences"
    __table_args__ = (UniqueConstraint("bill_id", "due_date"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    bill_id: Mapped[int] = mapped_column(ForeignKey("recurring_bills.id"))
    due_date: Mapped[str] = mapped_column(String(10))
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"))


class ExpenseCost(Base):
    __tablename__ = "expense_costs"
    entry_id: Mapped[int] = mapped_column(ForeignKey("journal_entries.id"), primary_key=True)
    usd: Mapped[str]
    bitcoin: Mapped[str]
    usd_per_btc: Mapped[str]
    source: Mapped[str]
    method: Mapped[str]
    observed_at: Mapped[str]
    created_at: Mapped[str] = mapped_column(default=now)


class PlanningScenario(Base):
    __tablename__ = "planning_scenarios"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(80))
    version: Mapped[int] = mapped_column(default=1)
    assumptions: Mapped[str] = mapped_column(Text)
    created_at: Mapped[str] = mapped_column(default=now)
    updated_at: Mapped[str] = mapped_column(default=now)
