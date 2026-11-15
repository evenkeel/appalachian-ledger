"""Savings goals and a reviewed marker for journal entries."""

from alembic import op
import sqlalchemy as sa

revision = "0013_goals_and_reviews"
down_revision = "0012_liquid_usd_exclusion"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "savings_goals",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("target_minor", sa.BigInteger(), nullable=False),
        sa.Column("target_date", sa.String(10), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "entry_reviews",
        sa.Column("entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), primary_key=True),
        sa.Column("reviewed_at", sa.String(), nullable=False),
    )


def downgrade():
    op.drop_table("entry_reviews")
    op.drop_table("savings_goals")
