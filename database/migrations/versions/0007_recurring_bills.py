"""Saved recurring bills and duplicate-safe payment occurrences."""

from alembic import op
import sqlalchemy as sa

revision = "0007_recurring_bills"
down_revision = "0006_holding_quotes"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "recurring_bills",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("amount", sa.String(80), nullable=False),
        sa.Column("frequency", sa.String(10), nullable=False),
        sa.Column("next_due", sa.String(10), nullable=False),
        sa.Column("anchor_day", sa.Integer(), nullable=False),
        sa.Column("anchor_month", sa.Integer(), nullable=False),
        sa.Column("archived", sa.Boolean(), nullable=False),
    )
    op.create_table(
        "bill_occurrences",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("bill_id", sa.Integer(), sa.ForeignKey("recurring_bills.id"), nullable=False),
        sa.Column("due_date", sa.String(10), nullable=False),
        sa.Column("entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), nullable=False),
        sa.UniqueConstraint("bill_id", "due_date"),
    )


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove recurring bills safely.")
