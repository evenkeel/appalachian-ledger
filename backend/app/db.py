"""Where the records are kept: one ledger file per person, and one small shared file.

A person's ledger file holds everything that is theirs: accounts, entries, bills, settings and
the prices their entries were recorded at. The shared file (`people.db`) holds only what is not
anyone's money: names, passwords, who is signed in, sign-in attempts and downloaded bitcoin
prices. A request can only ever reach the ledger of the person whose session cookie it carries,
because `get_db` opens that one file and no other. No query has a "whose is this" filter to
forget.
"""

import os
import secrets
import threading
import time
import hashlib
from pathlib import Path
from fastapi import HTTPException, Request
from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./data/ledger.db")
if not DATABASE_URL.startswith("sqlite:///"):
    raise RuntimeError("DATABASE_URL must be a sqlite:/// file path")
# The first ledger on this computer. Before people had separate ledgers it was the only one.
FIRST_LEDGER = Path(DATABASE_URL.removeprefix("sqlite:///"))
DATA_DIR = FIRST_LEDGER.parent
DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
PEOPLE_FILE = DATA_DIR / "people.db"
COOKIE = "ledger_session"


def _open(path):
    made = create_engine(f"sqlite:///{path}", connect_args={"check_same_thread": False, "timeout": 30})

    @event.listens_for(made, "connect")
    def configure_sqlite(conn, _):
        if made.url.database and made.url.database != ":memory:":
            os.chmod(made.url.database, 0o600)
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA busy_timeout=30000")

    return made


class Base(DeclarativeBase):
    """Tables inside one person's ledger file."""


class SharedBase(DeclarativeBase):
    """Tables in the shared file: people, sessions, sign-in attempts and market prices."""


# The first ledger's engine and session. Tests, migrations and scripts that work on a single
# throwaway ledger use these. Request handling never does: it goes through `get_db`.
engine = _open(FIRST_LEDGER)
SessionLocal = sessionmaker(engine, expire_on_commit=False)

people_engine = _open(PEOPLE_FILE)
People = sessionmaker(people_engine, expire_on_commit=False)

_ledgers = {FIRST_LEDGER.name: engine}
# A single local writer serializes journal writes and backup/restore. Run one worker.
write_lock = threading.Lock()


def ledger_path(name):
    """A ledger's file. Names are made by this app and never contain a path the person typed."""
    path = (DATA_DIR / name).resolve()
    if DATA_DIR.resolve() not in path.parents:
        raise ValueError("Ledger file is outside the data folder")
    return path


def ledger_engine(name):
    if name not in _ledgers:
        path = ledger_path(name)
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        _ledgers[name] = _open(path)
    return _ledgers[name]


def open_ledger(person):
    """A session on this one person's ledger file."""
    return sessionmaker(ledger_engine(person.ledger), expire_on_commit=False)()


def new_ledger_name(first):
    return FIRST_LEDGER.name if first else f"ledgers/{secrets.token_hex(8)}.db"


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def get_people():
    """The shared file alone, for the routes that run before anyone is signed in."""
    with write_lock, People() as people:
        try:
            yield people
            people.commit()
        except Exception:
            people.rollback()
            raise


def get_db(request: Request):
    """The signed-in person's ledger, found from their session cookie and nothing else."""
    from .people import Person, Session

    with write_lock, People() as people:
        token = request.cookies.get(COOKIE, "")
        session = people.get(Session, hash_token(token)) if token else None
        if not session or session.expires <= int(time.time()):
            raise HTTPException(401, "Please sign in")
        person = people.get(Person, session.person_id)
        request.state.session, request.state.person, request.state.people = session, person, people
        with open_ledger(person) as db:
            try:
                yield db
                db.commit()
                people.commit()
            except Exception:
                db.rollback()
                people.rollback()
                raise
