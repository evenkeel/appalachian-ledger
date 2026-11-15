"""Separate hypothetical planning assumptions from financial journals."""

from alembic import op
import sqlalchemy as sa

revision = "0011_planning_scenarios"
down_revision = "0010_spending_types"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "planning_scenarios",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("assumptions", sa.Text(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
    )


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove saved scenarios safely.")
