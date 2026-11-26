"""Keep every ledger and the shared file on the schema required by the running code."""

import os
import sqlite3

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, select, text

from .db import FIRST_LEDGER, People, SharedBase, engine, ledger_engine, people_engine
from .paths import ALEMBIC_INI
from . import people as _tables  # noqa: F401  (registers the shared tables)
from .people import Person


def migrate(target):
    """Bring one ledger file up to date. Fail loudly; never serve a half-upgraded ledger."""
    config = Config(str(ALEMBIC_INI))
    heads = set(ScriptDirectory.from_config(config).get_heads())
    with target.connect() as connection:
        if set(MigrationContext.configure(connection).get_current_heads()) == heads:
            return
        config.attributes["connection"] = connection
        command.upgrade(config, "head")
        connection.commit()


def adopt_first_ledger():
    """The ledger from before people had their own becomes the first person's, where it is.

    Only the name and password are copied out, into the shared file. A safety copy of the
    ledger is saved beside it first. Every money record stays in the same file, unread.
    """
    with People() as people:
        if people.scalar(select(Person.id).limit(1)) is not None:
            return
        with engine.connect() as connection:
            if "users" not in inspect(connection).get_table_names():
                return
            owner = connection.execute(
                text("SELECT username, password_hash, created_at FROM users ORDER BY id LIMIT 1")
            ).first()
        if owner is None or not owner.password_hash:
            return
        keep = FIRST_LEDGER.with_name(FIRST_LEDGER.stem + ".before-people.db")
        if not keep.exists():
            with sqlite3.connect(FIRST_LEDGER) as source, sqlite3.connect(keep) as copy:
                source.backup(copy)
            os.chmod(keep, 0o600)
        people.add(
            Person(
                username=owner.username,
                password_hash=owner.password_hash,
                ledger=FIRST_LEDGER.name,
                created_at=owner.created_at,
            )
        )
        people.commit()


def everyone():
    with People() as people:
        return list(people.scalars(select(Person).order_by(Person.id)))


def ensure_schema():
    SharedBase.metadata.create_all(people_engine)
    adopt_first_ledger()
    migrate(engine)
    for person in everyone():
        migrate(ledger_engine(person.ledger))
