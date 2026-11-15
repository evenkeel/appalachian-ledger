"""Share positions and market quote cache."""

from alembic import op
import sqlalchemy as sa

revision = "0005_holdings"
down_revision = "0004_price_sync"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "portfolios",
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("accounts.id"), primary_key=True),
        sa.Column("started_on", sa.String(), nullable=False),
        sa.Column("attempted_at", sa.String()),
        sa.Column("error", sa.String()),
    )
    op.create_table(
        "holdings",
        sa.Column("account_id", sa.Integer(), sa.ForeignKey("portfolios.account_id"), primary_key=True),
        sa.Column("symbol", sa.String(), primary_key=True),
        sa.Column("shares", sa.String(), nullable=False),
        sa.Column("cost_minor", sa.BigInteger()),
        sa.Column("marked_minor", sa.BigInteger(), nullable=False),
    )
    op.create_table(
        "stock_quotes",
        sa.Column("symbol", sa.String(), primary_key=True),
        *[
            sa.Column(name, sa.String(), nullable=False)
            for name in ("price", "previous_close", "observed_at", "fetched_at")
        ],
    )


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove share tracking safely.")
