"""Separate current quotes, daily reference metadata, and missing conversions."""

from alembic import op
import sqlalchemy as sa

revision = "0004_price_sync"
down_revision = "0003_currency_budgets"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("exchange_rates", sa.Column("observed_at", sa.String(), nullable=True))
    # Existing rows stay byte-for-byte intact and are never relabeled as verified closes.
    op.add_column("exchange_rates", sa.Column("method", sa.String(), nullable=False, server_default="legacy"))
    op.create_index("ix_rates_source_day_method", "exchange_rates", ["source", "day", "method"])
    op.create_table(
        "price_quotes",
        sa.Column("source", sa.String(), primary_key=True),
        sa.Column("usd_per_btc", sa.String(), nullable=False),
        sa.Column("observed_at", sa.String(), nullable=False),
        sa.Column("fetched_at", sa.String(), nullable=False),
    )
    op.create_table(
        "price_sync",
        sa.Column("source", sa.String(), primary_key=True),
        *[
            sa.Column(name, sa.String(), nullable=True)
            for name in (
                "start_day",
                "end_day",
                "next_day",
                "error",
                "quote_error",
                "quote_attempt_at",
                "history_attempt_at",
                "last_success_at",
                "scheduled_day",
            )
        ],
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("generation", sa.Integer(), nullable=False),
        sa.Column("quote_requested", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "conversion_attachments",
        sa.Column("entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), primary_key=True),
        sa.Column("rate_id", sa.Integer(), sa.ForeignKey("exchange_rates.id"), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    for operation in ("UPDATE", "DELETE"):
        op.execute(f"""CREATE TRIGGER conversion_no_{operation.lower()} BEFORE {operation} ON conversion_attachments
            BEGIN SELECT RAISE(ABORT, 'Conversion attachments are immutable'); END""")
    op.execute("""CREATE TRIGGER conversion_valid BEFORE INSERT ON conversion_attachments BEGIN
        SELECT CASE WHEN NOT EXISTS (
            SELECT 1 FROM journal_entries j JOIN exchange_rates r ON r.id=NEW.rate_id
            WHERE j.id=NEW.entry_id AND j.status='posted' AND j.rate_snapshot IS NULL
              AND j.kind != 'reversal' AND j.date=r.day
              AND r.method IN ('daily_close', 'midnight', 'manual')
              AND NOT EXISTS (SELECT 1 FROM journal_entries x WHERE x.reverses_id=j.id)
        ) THEN RAISE(ABORT, 'Only missing conversions can be completed with an exact-date reference') END;
    END""")


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove pricing history safely.")
