"""Expected income whose amount varies, such as tips or side work."""

from alembic import op
import sqlalchemy as sa

revision = "0015_income_varies"
down_revision = "0014_dashboard"
branch_labels = None
depends_on = None


def upgrade():
    # Added in place; every existing schedule keeps a fixed amount.
    op.add_column("income_schedules", sa.Column("varies", sa.Boolean(), nullable=False, server_default="0"))


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove varying income safely.")
