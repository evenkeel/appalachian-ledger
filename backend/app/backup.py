"""Authenticated encrypted SQLite snapshots, validated before atomic replacement."""

import hashlib
import json
import os
import sqlite3
import tempfile

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import create_engine, event
from sqlalchemy.exc import SQLAlchemyError

from .db import engine
from .paths import ALEMBIC_INI
from .money import rate_decimal, convert
from .prices import parse_time

MAGIC = b"APPALACHIAN-LEDGER\x01"
MAX_BYTES = 32 * 1024 * 1024


def key(passphrase, salt):
    return hashlib.scrypt(passphrase.encode(), salt=salt, n=32768, r=8, p=1, dklen=32, maxmem=64 * 1024 * 1024)


def schema(conn):
    return list(
        conn.execute("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")
    )


def snapshot(db, passphrase):
    db.commit()
    with sqlite3.connect(engine.url.database) as source, sqlite3.connect(":memory:") as memory:
        source.backup(memory)
        memory.execute("DELETE FROM sessions")
        memory.execute("DELETE FROM login_attempts")
        memory.commit()
        plain = memory.serialize()
        if len(plain) > MAX_BYTES - 128:
            raise ValueError(
                "This database exceeds the 32 MB encrypted-backup limit. Use an offline filesystem backup."
            )
    salt, nonce = os.urandom(16), os.urandom(12)
    return MAGIC + salt + nonce + AESGCM(key(passphrase, salt)).encrypt(nonce, plain, MAGIC)


def validate(conn, current):
    if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise ValueError("Backup failed SQLite integrity check")
    if schema(conn) != schema(current):
        raise ValueError(
            "Backup schema does not match this application version, even after upgrading it. Nothing was changed."
        )
    if list(conn.execute("PRAGMA foreign_key_check")):
        raise ValueError("Backup has broken foreign keys")
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0] != 1:
        raise ValueError("Backup must contain exactly one local owner")
    from .planning import ScenarioInput

    for name, version, assumptions in conn.execute("SELECT name,version,assumptions FROM planning_scenarios"):
        if version != 1:
            raise ValueError("Backup contains an unsupported planning scenario version")
        try:
            ScenarioInput(name=name, assumptions=json.loads(assumptions))
        except (ValueError, TypeError):
            raise ValueError("Backup contains invalid planning assumptions") from None
    if conn.execute("SELECT COUNT(*) FROM journal_entries WHERE status != 'posted'").fetchone()[0]:
        raise ValueError("Backup contains unfinished journal entries")
    for (id,) in conn.execute("SELECT id FROM journal_entries"):
        legs = list(
            conn.execute(
                "SELECT a.currency,p.amount_minor FROM postings p JOIN accounts a ON a.id=p.account_id WHERE p.entry_id=?",
                (id,),
            )
        )
        totals = {}
        for currency, amount in legs:
            if type(amount) is not int:
                raise ValueError("Invalid posting amount")
            totals[currency] = totals.get(currency, 0) + amount
        if len(legs) < 2 or any(totals.values()):
            raise ValueError("Backup has an unbalanced journal")
    for (value,) in conn.execute("SELECT usd_per_btc FROM exchange_rates"):
        rate_decimal(value)
    for value, observed, fetched in conn.execute("SELECT usd_per_btc,observed_at,fetched_at FROM price_quotes"):
        rate_decimal(value)
        parse_time(observed)
        parse_time(fetched)
    for (
        usd,
        bitcoin,
        rate,
        amount,
        currency,
        kind,
    ) in conn.execute("""SELECT c.usd,c.bitcoin,c.usd_per_btc,j.amount_minor,a.currency,j.kind
        FROM expense_costs c JOIN journal_entries j ON j.id=c.entry_id JOIN accounts a ON a.id=j.account_id"""):
        rate_decimal(rate)
        if (
            kind != "expense"
            or usd != convert(amount, currency, "USD", rate)
            or bitcoin != convert(amount, currency, "BITCOIN", rate)
        ):
            raise ValueError("Backup contains an invalid expense cost snapshot")
    if conn.execute("""SELECT COUNT(*) FROM conversion_attachments a
        JOIN journal_entries j ON j.id=a.entry_id JOIN exchange_rates r ON r.id=a.rate_id
        WHERE j.rate_snapshot IS NOT NULL OR j.date != r.day OR j.kind='reversal'
            OR r.method NOT IN ('daily_close','midnight','manual')""").fetchone()[0]:
        raise ValueError("Backup contains invalid conversion attachments")


def upgrade_candidate(path):
    """Bring a backup made by an older version up to this version, in the temporary copy only.

    The same migrations that upgrade a ledger at startup run here, so nothing is
    converted by a second code path. A backup from a newer version is refused.
    """
    config = Config(str(ALEMBIC_INI))
    script = ScriptDirectory.from_config(config)
    heads = set(script.get_heads())
    known = {revision.revision for revision in script.walk_revisions()}
    candidate = create_engine(f"sqlite:///{path}")

    @event.listens_for(candidate, "connect")
    def configure(conn, _):
        conn.execute("PRAGMA foreign_keys=ON")

    try:
        with candidate.connect() as connection:
            current = set(MigrationContext.configure(connection).get_current_heads())
            if current == heads or not current:
                # Up to date, or not a migrated ledger at all: validation decides.
                return
            if not current <= known:
                raise ValueError("This backup was made by a newer version of the app. Update the app, then restore it.")
            config.attributes["connection"] = connection
            command.upgrade(config, "head")
            connection.commit()
    except SQLAlchemyError:
        raise ValueError("Backup could not be upgraded to this version. Nothing was changed.") from None
    finally:
        candidate.dispose()


def restore(db, content, passphrase):
    if len(content) > MAX_BYTES or not content.startswith(MAGIC):
        raise ValueError("Invalid or oversized encrypted backup")
    pos = len(MAGIC)
    salt, nonce, encrypted = content[pos : pos + 16], content[pos + 16 : pos + 28], content[pos + 28 :]
    try:
        plain = AESGCM(key(passphrase, salt)).decrypt(nonce, encrypted, MAGIC)
    except Exception:
        raise ValueError("Backup passphrase is incorrect or backup is damaged") from None
    # A temporary SQLite connection validates the entire candidate before any mutation.
    with tempfile.TemporaryDirectory() as folder:
        path = os.path.join(folder, "candidate.db")
        with open(path, "wb") as file:
            file.write(plain)
        upgrade_candidate(path)
        try:
            with sqlite3.connect(path) as candidate, sqlite3.connect(engine.url.database) as current:
                validate(candidate, current)
                candidate.execute("DELETE FROM sessions")
                candidate.execute("DELETE FROM login_attempts")
                candidate.commit()
                db.commit()
                db.close()
                from .price_sync import invalidate_inflight

                invalidate_inflight()
                engine.dispose()
                # SQLite backup API copies within a destination transaction, keeping restore atomic.
                candidate.backup(current)
        except sqlite3.DatabaseError:
            raise ValueError("Backup is not a valid ledger database") from None
