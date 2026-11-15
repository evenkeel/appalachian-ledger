"""Seal balanced entries and preserve immutable accounting history."""

from alembic import op

revision = "0002"
down_revision = "df5cdff8c9ca"
branch_labels = None
depends_on = None

TRIGGERS = {
    "entry_insert_draft": """BEFORE INSERT ON journal_entries WHEN NEW.status != 'draft'
        BEGIN SELECT RAISE(ABORT, 'Entries must start as drafts'); END""",
    "entry_balance": """BEFORE UPDATE OF status ON journal_entries WHEN NEW.status = 'posted'
        BEGIN
          SELECT CASE WHEN (SELECT COUNT(*) FROM postings WHERE entry_id=NEW.id) < 2
            THEN RAISE(ABORT, 'At least two postings required') END;
          SELECT CASE WHEN EXISTS (
            SELECT a.currency FROM postings p JOIN accounts a ON a.id=p.account_id
            WHERE p.entry_id=NEW.id GROUP BY a.currency HAVING SUM(p.amount_minor) != 0)
            THEN RAISE(ABORT, 'Unbalanced journal') END;
        END""",
    "entry_no_update": """BEFORE UPDATE ON journal_entries WHEN OLD.status='posted'
        BEGIN SELECT RAISE(ABORT, 'Posted entries are immutable'); END""",
    "entry_no_delete": """BEFORE DELETE ON journal_entries WHEN OLD.status='posted'
        BEGIN SELECT RAISE(ABORT, 'Posted entries are immutable'); END""",
    "posting_no_insert": """BEFORE INSERT ON postings WHEN (SELECT status FROM journal_entries WHERE id=NEW.entry_id)='posted'
        BEGIN SELECT RAISE(ABORT, 'Posted entries are sealed'); END""",
    "posting_no_update": """BEFORE UPDATE ON postings
        BEGIN SELECT RAISE(ABORT, 'Postings are immutable'); END""",
    "posting_no_delete": """BEFORE DELETE ON postings
        BEGIN SELECT RAISE(ABORT, 'Postings are immutable'); END""",
    "account_currency_fixed": """BEFORE UPDATE OF currency,role,internal ON accounts
        BEGIN SELECT RAISE(ABORT, 'Account denomination and role are immutable'); END""",
    "rate_no_update": """BEFORE UPDATE ON exchange_rates
        BEGIN SELECT RAISE(ABORT, 'Rate snapshots are immutable'); END""",
    "rate_no_delete": """BEFORE DELETE ON exchange_rates
        BEGIN SELECT RAISE(ABORT, 'Rate snapshots are immutable'); END""",
    "audit_no_update": """BEFORE UPDATE ON audit_events
        BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END""",
    "audit_no_delete": """BEFORE DELETE ON audit_events
        BEGIN SELECT RAISE(ABORT, 'Audit events are immutable'); END""",
}


def upgrade():
    for name, sql in TRIGGERS.items():
        op.execute(f"CREATE TRIGGER {name} {sql}")


def downgrade():
    for name in TRIGGERS:
        op.execute(f"DROP TRIGGER {name}")
