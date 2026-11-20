"""Paycheck schedules, card terms, alert lights, and bills that pay down or destroy a debt."""

from alembic import op
import sqlalchemy as sa

revision = "0014_dashboard"
down_revision = "0013_goals_and_reviews"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "income_schedules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("amount", sa.String(80), nullable=False),
        sa.Column("frequency", sa.String(12), nullable=False),
        sa.Column("next_date", sa.String(10), nullable=False),
        sa.Column("anchor_day", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "card_terms",
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), primary_key=True),
        sa.Column("credit_limit_minor", sa.BigInteger(), nullable=True),
        sa.Column("due_day", sa.Integer(), nullable=True),
    )
    op.create_table(
        "alert_acknowledgements",
        sa.Column("alert_id", sa.String(20), primary_key=True),
        sa.Column("level", sa.String(10), nullable=False),
        sa.Column("magnitude", sa.String(80), nullable=False),
        sa.Column("acknowledged_at", sa.String(), nullable=False),
    )
    op.create_table(
        "alert_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("settings", sa.Text(), nullable=False),
    )
    # Both columns are added in place. A batch operation would rebuild recurring_bills,
    # and dropping the old copy fails (foreign keys are on) as soon as one recorded
    # bill occurrence points at it, leaving the ledger half migrated.
    op.execute("ALTER TABLE recurring_bills ADD COLUMN pays_account_id INTEGER REFERENCES accounts (id)")
    op.add_column("recurring_bills", sa.Column("destroyed_on", sa.String(10), nullable=True))


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove dashboard schedules and bill links safely.")
