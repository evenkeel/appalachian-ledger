"""Currency-specific budgets; preserve legacy combined purchasing-power budgets."""

from alembic import op
import sqlalchemy as sa

revision = "0003_currency_budgets"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "budgets_new",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("month", sa.String(), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("amount_minor", sa.BigInteger(), nullable=False),
        sa.Column("currency", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=False),
        sa.UniqueConstraint("month", "category_id", "currency"),
        sa.CheckConstraint("amount_minor > 0 AND typeof(amount_minor) = 'integer'"),
        sa.CheckConstraint("currency IN ('USD', 'BITCOIN')"),
        sa.CheckConstraint("scope IN ('native', 'all')"),
    )
    op.execute("INSERT INTO budgets_new SELECT id, month, category_id, bitcoin, 'BITCOIN', 'all' FROM budgets")
    op.drop_table("budgets")
    op.rename_table("budgets_new", "budgets")
    op.create_index("ix_budgets_month", "budgets", ["month"])


def downgrade():
    raise RuntimeError("Currency budgets cannot be safely collapsed to bitcoin. Restore a pre-migration backup.")
