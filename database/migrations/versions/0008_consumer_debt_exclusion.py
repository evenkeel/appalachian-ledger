"""Persist account-level consumer debt gauge exclusions."""

from alembic import op
import sqlalchemy as sa

revision = "0008_consumer_debt_exclusion"
down_revision = "0007_recurring_bills"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("accounts", sa.Column("exclude_from_consumer_debt", sa.Boolean(), nullable=False, server_default="0"))


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove consumer debt exclusions safely.")
