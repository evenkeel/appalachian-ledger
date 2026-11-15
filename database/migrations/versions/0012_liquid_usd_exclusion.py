"""Allow checking accounts to be reserved outside everyday liquid USD."""

from alembic import op
import sqlalchemy as sa

revision = "0012_liquid_usd_exclusion"
down_revision = "0011_planning_scenarios"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "accounts",
        sa.Column("exclude_from_liquid_usd", sa.Boolean(), nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_column("accounts", "exclude_from_liquid_usd")
