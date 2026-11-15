"""Classify expenses for the cash flow cockpit."""

from alembic import op
import sqlalchemy as sa

revision = "0010_spending_types"
down_revision = "0009_expense_costs"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("categories", sa.Column("spending_type", sa.String(), nullable=False, server_default="unclassified"))


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove spending classifications safely.")
