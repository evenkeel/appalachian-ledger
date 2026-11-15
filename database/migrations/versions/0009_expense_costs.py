"""Freeze purchase-date expense equivalents with price provenance."""

from alembic import op
import sqlalchemy as sa

revision = "0009_expense_costs"
down_revision = "0008_consumer_debt_exclusion"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "expense_costs",
        sa.Column("entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), primary_key=True),
        *[
            sa.Column(name, sa.String(), nullable=False)
            for name in ("usd", "bitcoin", "usd_per_btc", "source", "method", "observed_at", "created_at")
        ],
    )
    for operation in ("UPDATE", "DELETE"):
        op.execute(
            f"CREATE TRIGGER expense_costs_no_{operation.lower()} BEFORE {operation} ON expense_costs BEGIN SELECT RAISE(ABORT, 'Expense cost history is immutable'); END"
        )


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove expense cost history safely.")
