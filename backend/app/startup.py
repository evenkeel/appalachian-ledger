"""Keep every API entry point on the schema required by the running code."""

from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory

from .db import engine
from .paths import ALEMBIC_INI


def ensure_schema():
    config = Config(str(ALEMBIC_INI))
    heads = set(ScriptDirectory.from_config(config).get_heads())
    with engine.connect() as connection:
        current = set(MigrationContext.configure(connection).get_current_heads())
    if current != heads:
        # Fail startup if an upgrade fails; never serve partially compatible APIs.
        command.upgrade(config, "head")
