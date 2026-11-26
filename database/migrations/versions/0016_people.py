"""Each person has their own ledger file; sign-in moved to the shared file."""

from alembic import op

revision = "0016_people"
down_revision = "0015_income_varies"
branch_labels = None
depends_on = None


def upgrade():
    # Startup copies the name and password into the shared file before this runs.
    # No money record is touched: only sign-in bookkeeping leaves the ledger.
    op.execute("DROP TABLE IF EXISTS sessions")
    op.execute("DROP TABLE IF EXISTS login_attempts")
    op.execute("UPDATE users SET password_hash = ''")


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to return to a single shared ledger.")
