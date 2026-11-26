"""Income sources: who pays, kept beside the journal."""

from alembic import op
import sqlalchemy as sa

revision = "0017_income_sources"
down_revision = "0016_people"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "income_sources",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("ended_on", sa.String(10)),
        sa.Column("merged_into_id", sa.Integer(), sa.ForeignKey("income_sources.id")),
        sa.Column("created_at", sa.String(), nullable=False),
    )
    op.create_table(
        "income_source_names",
        sa.Column("name_key", sa.String(500), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("income_sources.id"), nullable=False),
    )
    op.create_table(
        "income_entry_sources",
        sa.Column("entry_id", sa.Integer(), sa.ForeignKey("journal_entries.id"), primary_key=True),
        sa.Column("source_id", sa.Integer(), sa.ForeignKey("income_sources.id"), nullable=False),
    )
    op.create_index("ix_income_entry_sources_source_id", "income_entry_sources", ["source_id"])
    # Added in place; existing schedules get their source the first time income is read.
    op.add_column("income_schedules", sa.Column("source_id", sa.Integer()))


def downgrade():
    raise RuntimeError("Restore a pre-migration backup to remove income sources safely.")
