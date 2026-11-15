"""Keep each position's quote consistent with its last posted market value."""

from alembic import op
import sqlalchemy as sa

revision = "0006_holding_quotes"
down_revision = "0005_holdings"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("holdings", sa.Column("quote_snapshot", sa.Text(), nullable=False, server_default="{}"))


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove position quotes safely.")
