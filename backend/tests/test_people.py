"""Several people on one computer: each ledger is private, prices are shared.

Two people are made with different money. Every read route and every write route is then
used as each of them, and the other person's ledger file is compared before and after,
row for row.
"""

import json
import re
import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pytest
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import select, text

from app import db as app_db, price_sync
from app.backup import MAGIC, key
from app.db import PEOPLE_FILE, People, engine, open_ledger
from app.main import app
from app.models import ExchangeRate, ExpenseCost, User
from app.people import Person, Session
from app.prices import Reference
from app.startup import ensure_schema
from conftest import category, new_account, post, transaction

PASSWORDS = {"ann": "ann-long-password-one", "ben": "ben-long-password-two"}


def join(name, manual=True):
    """A new person, signed in on their own browser."""
    browser = TestClient(app)
    reply = browser.post("/api/auth/setup", json={"username": name, "password": PASSWORDS[name]})
    assert reply.status_code == 200, reply.text
    browser.headers["X-CSRF-Token"] = reply.json()["csrf"]
    if manual:
        with ledger_of(name) as db:
            user = db.scalar(select(User))
            user.preferences = json.dumps(
                json.loads(user.preferences) | {"rate_source": "manual", "automatic_prices": False}
            )
            db.commit()
    return browser


def person(name):
    with People() as people:
        return people.scalar(select(Person).where(Person.username == name))


def ledger_of(name):
    return open_ledger(person(name))


def file_of(name):
    return app_db.ledger_path(person(name).ledger)


def dump(name):
    """Every row of every table in one person's ledger file."""
    with sqlite3.connect(file_of(name)) as conn:
        return list(conn.iterdump())


@pytest.fixture
def household(client):
    """Ann has the fictional demo's money. Ben has a small ledger with names found nowhere else."""
    ann = join("ann")
    assert ann.post("/api/demo?months=6").status_code == 200
    post(
        ann,
        "/goals",
        {"name": "Ann cabin fund", "account_id": ann.get("/api/accounts").json()[0]["id"], "target": "9000"},
    )
    ben = join("ben")
    vault = new_account(ben, name="Ben zebra vault", amount="4321")
    transaction(ben, vault, amount="77.70", description="Ben quartz invoice")
    post(ben, "/rates", {"day": "2026-01-05", "usd_per_btc": "91234.56"})
    return ann, ben


def fingerprints(browser, username):
    """Words that appear only in this person's ledger."""
    words = {username}
    words |= {row["name"] for row in browser.get("/api/accounts").json()}
    words |= {row["description"] for row in browser.get("/api/transactions").json()}
    words |= {row["description"] for row in browser.get("/api/recurring-bills").json()}
    words |= {row["name"] for row in browser.get("/api/goals").json()}
    # Everyone starts with the same category names; an entry may be named after one.
    shared = {row["name"] for row in browser.get("/api/categories").json()}
    return {word for word in words - shared if len(word) >= 6}


TODAY = date.today()
MONTH = TODAY.strftime("%Y-%m")
# Questions a read route needs before it will answer.
QUERY = {
    "/api/budgets": {"month": MONTH},
    "/api/tracking": {"month": MONTH},
    "/api/budget-overview": {"month": MONTH},
    "/api/spending-history": {"start": str(TODAY - timedelta(days=200)), "end": str(TODAY), "interval": "month"},
    "/api/reports": {"months": 6},
}
# Routes that hold no ledger data: market feeds and the optional node, which need the network.
NOT_LEDGER = re.compile(r"^/api/(market/|node/status|node/wallets/\{id\}/reconcile|health$)")
BEFORE_SIGN_IN = {"/api/auth/status", "/api/auth/setup", "/api/auth/login"}


def routes(reads):
    for route in app.routes:
        if not isinstance(route, APIRoute) or NOT_LEDGER.match(route.path) or route.path in BEFORE_SIGN_IN:
            continue
        for method in route.methods - {"HEAD", "OPTIONS"}:
            if (method == "GET") == reads:
                yield method, route.path


def read_everything(browser, ids=("1",)):
    """The text of every read route's answer, for each id given."""
    answers = {}
    for method, path in routes(reads=True):
        for id in ids if "{id}" in path else ("",):
            url = path.replace("{id}", id)
            reply = browser.get(url, params=QUERY.get(path))
            assert reply.status_code < 500, (url, reply.text)
            if "{id}" not in path:
                assert reply.status_code == 200, (url, reply.text)
            answers[url] = reply.text
    return answers


def test_nobody_is_listed_before_sign_in(household):
    stranger = TestClient(app)
    status = stranger.get("/api/auth/status")
    assert status.json() == {"initialized": True, "demo_enabled": True}
    assert "ann" not in status.text and "ben" not in status.text
    for method, path in [*routes(reads=True), *routes(reads=False)]:
        reply = stranger.request(method, path.replace("{id}", "1"), params=QUERY.get(path))
        assert reply.status_code == 401, (method, path, reply.status_code)


def test_every_read_route_shows_only_your_own_ledger(household):
    ann, ben = household
    hers, his = fingerprints(ann, "ann"), fingerprints(ben, "ben")
    assert len(hers) > 20 and {"Ben zebra vault", "Ben quartz invoice"} <= his and not hers & his
    # Ask as each person, with every id the other person's ledger uses.
    with sqlite3.connect(file_of("ann")) as conn:
        her_ids = [str(n) for n in range(1, 40)] + [
            str(conn.execute("SELECT MAX(id) FROM journal_entries").fetchone()[0])
        ]
    as_ben = read_everything(ben, her_ids)
    as_ann = read_everything(ann, ["1", "2"])
    assert len(as_ben) > 40
    for url, answer in as_ben.items():
        assert not [word for word in hers if word in answer], f"Ben saw Ann's records at {url}"
    for url, answer in as_ann.items():
        assert not [word for word in his if word in answer], f"Ann saw Ben's records at {url}"
    # The check has teeth: each person's own records do appear in their own answers.
    assert "Ben zebra vault" in "".join(as_ben.values())
    assert all(any(word in answer for answer in as_ann.values()) for word in list(hers)[:10])
    assert ann.get("/api/auth/me").json()["username"] == "ann"
    assert ben.get("/api/auth/me").json()["username"] == "ben"


def test_every_write_route_changes_only_your_own_ledger(household):
    ann, ben = household
    before = dump("ann")
    with sqlite3.connect(file_of("ann")) as conn:
        her_ids = ["1", "2", "3", str(conn.execute("SELECT MAX(id) FROM journal_entries").fetchone()[0])]
    skip = {"/api/auth/logout", "/api/auth/password", "/api/restore", "/api/demo"}  # used for real below
    tried = 0
    for method, path in routes(reads=False):
        if path in skip:
            continue
        for id in her_ids if "{id}" in path else [""]:
            for body in ({}, {"date": str(TODAY), "amount": "5", "name": "x", "description": "x", "account_id": 1}):
                reply = ben.request(method, path.replace("{id}", id), json=body)
                assert reply.status_code < 500, (method, path, reply.text)
                tried += 1
    assert tried > 150
    # Real work in Ben's ledger, touching every kind of record.
    vault = ben.get("/api/accounts").json()[0]["id"]
    spend = category(ben, "expense")
    transaction(ben, vault, amount="12.34", description="Ben second purchase")
    bill = post(
        ben,
        "/recurring-bills",
        {
            "transaction": {
                "date": str(TODAY),
                "kind": "expense",
                "account_id": vault,
                "category_id": spend,
                "amount": "900",
                "description": "Ben rent",
            },
            "frequency": "monthly",
        },
    )
    post(ben, f"/recurring-bills/{bill['id']}/record", {"due_date": str(TODAY), "date": str(TODAY), "amount": "900"})
    post(ben, "/budgets", {"month": MONTH, "category_id": spend, "amount": "300", "currency": "USD", "scope": "all"})
    post(ben, "/categories", {"name": "Ben hobby", "kind": "expense"})
    post(ben, "/goals", {"name": "Ben goal", "account_id": vault, "target": "100"})
    post(
        ben,
        "/income-schedules",
        {"account_id": vault, "name": "Ben pay", "amount": "2000", "frequency": "monthly", "next_date": str(TODAY)},
    )
    assert ben.put("/api/settings/monetary-lens", json={"denomination": "BITCOIN"}).status_code == 200
    assert ben.post("/api/alerts/acknowledge-all").status_code == 200
    assert ben.post("/api/demo").status_code == 422  # his ledger is not empty; hers is not offered
    changed = ben.post(
        "/api/auth/password", json={"current_password": PASSWORDS["ben"], "new_password": "ben-new-password"}
    )
    assert changed.status_code == 200
    ben.headers["X-CSRF-Token"] = changed.json()["csrf"]
    assert ben.get("/api/export/csv").status_code == 200

    assert dump("ann") == before
    # Ann is still signed in, with her own password and her own settings.
    assert ann.get("/api/settings").json()["preferences"]["denomination"] != "BITCOIN"
    assert ann.get("/api/accounts").status_code == 200
    fresh = TestClient(app)
    assert fresh.post("/api/auth/login", json={"username": "ann", "password": "ben-new-password"}).status_code == 401
    assert fresh.post("/api/auth/login", json={"username": "ann", "password": PASSWORDS["ann"]}).status_code == 200
    assert ben.post("/api/auth/logout").status_code == 200
    assert ben.get("/api/accounts").status_code == 401 and ann.get("/api/accounts").status_code == 200


def test_a_session_opens_one_ledger_and_cannot_be_pointed_at_another(household):
    ann, ben = household
    # Ben's cookie with Ann's CSRF token, and the reverse, are refused for writes.
    mixed = TestClient(app)
    mixed.cookies.update(ben.cookies)
    assert mixed.get("/api/auth/me").json()["username"] == "ben"
    mixed.headers["X-CSRF-Token"] = ann.headers["X-CSRF-Token"]
    assert mixed.post("/api/categories", json={"name": "Sneak", "kind": "expense"}).status_code == 403
    # A session row names one person, and that person names one file.
    with People() as people:
        files = {row.ledger for row in people.scalars(select(Person))}
        assert len(files) == 2 and len(list(people.scalars(select(Session)))) == 2
    assert file_of("ann") != file_of("ben")
    assert file_of("ann").name == Path(engine.url.database).name  # the first ledger stays where it was
    with pytest.raises(ValueError):
        app_db.ledger_path("../outside.db")


def test_backup_holds_one_ledger_and_restore_touches_one_ledger(household):
    ann, ben = household
    hers = fingerprints(ann, "ann")
    phrase = "ben-backup-phrase"
    made = ben.post("/api/backup", json={"passphrase": phrase})
    assert made.status_code == 200
    pos = len(MAGIC)
    plain = AESGCM(key(phrase, made.content[pos : pos + 16])).decrypt(
        made.content[pos + 16 : pos + 28], made.content[pos + 28 :], MAGIC
    )
    assert b"Ben zebra vault" in plain
    assert not [word for word in hers if word.encode() in plain]
    assert b"argon2" not in plain  # no password travels in a backup
    with sqlite3.connect(":memory:") as conn:
        conn.deserialize(plain)
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert not tables & {"people", "sessions", "login_attempts", "market_days"}

    transaction(ben, ben.get("/api/accounts").json()[0]["id"], amount="1.11", description="Ben after backup")
    ann_before = dump("ann")
    files = {"file": ("ledger.albackup", made.content, "application/octet-stream")}
    assert ben.post("/api/restore", data={"passphrase": phrase}, files=files).status_code == 200
    assert dump("ann") == ann_before
    assert ann.get("/api/accounts").status_code == 200  # she was not signed out
    assert ben.get("/api/accounts").status_code == 401  # he signs in again
    back = ben.post("/api/auth/login", json={"username": "ben", "password": PASSWORDS["ben"]})
    ben.headers["X-CSRF-Token"] = back.json()["csrf"]
    assert "Ben after backup" not in ben.get("/api/transactions").text

    # Ann's backup, restored by Ben with her passphrase, replaces his ledger and nothing of hers.
    theirs = ann.post("/api/backup", json={"passphrase": "ann-phrase"})
    ann_before = dump("ann")
    files = {"file": ("ledger.albackup", theirs.content, "application/octet-stream")}
    assert ben.post("/api/restore", data={"passphrase": "ann-phrase"}, files=files).status_code == 200
    assert dump("ann") == ann_before
    back = ben.post("/api/auth/login", json={"username": "ben", "password": PASSWORDS["ben"]})
    assert back.status_code == 200 and back.json()["username"] == "ben"
    with ledger_of("ben") as db:
        row = db.scalar(select(User))
        assert (row.username, row.password_hash) == ("ben", "")


class CountingSource:
    name, method, batch_days = "Coinbase", "daily_close", 300

    def __init__(self):
        self.quotes = self.histories = 0

    def current(self):
        self.quotes += 1
        now = price_sync.utcnow()
        return Reference(now.date(), "100000.00", now.isoformat(), "spot")

    def history(self, start, end):
        self.histories += 1
        days = (end - start).days + 1
        return [
            Reference(
                start + timedelta(days=n), "90000.00", f"{start + timedelta(days=n + 1)}T00:00:00+00:00", self.method
            )
            for n in range(days)
        ]


def test_prices_are_fetched_once_and_every_ledger_is_priced(client, monkeypatch):
    ann, ben, cat = join("ann", manual=False), join("ben", manual=False), join_manual()
    source = CountingSource()
    monkeypatch.setattr(price_sync, "provider_for", lambda _: source)
    spent = {}
    for name, browser in (("ann", ann), ("ben", ben), ("cat", cat)):
        account = new_account(browser, name=f"{name} checking")
        spent[name] = transaction(browser, account, amount="50.00", date=str(TODAY), description=f"{name} lunch")["id"]
    while price_sync.tick():
        pass
    # Three ledgers, two of them on Coinbase: one quote and one history download in all.
    assert (source.quotes, source.histories) == (1, 1)
    for name in ("ann", "ben"):
        with ledger_of(name) as db:
            cost = db.get(ExpenseCost, spent[name])
            assert cost is not None and cost.usd_per_btc == "100000.00" and cost.method == "spot"
            assert db.scalar(select(ExchangeRate.id).where(ExchangeRate.source == "Coinbase").limit(1)) is not None
    # The person on manual prices gets nothing they did not type.
    with ledger_of("cat") as db:
        assert db.get(ExpenseCost, spent["cat"]) is None
        assert db.scalar(select(ExchangeRate.id).limit(1)) is None
    # A price typed by hand belongs to the ledger it was typed into.
    post(ann, "/rates", {"day": "2026-01-05", "usd_per_btc": "12345.67"})
    assert "12345.67" not in ben.get("/api/rates").text and "12345.67" in ann.get("/api/rates").text


PASSWORDS["cat"] = "cat-long-password-three"


def join_manual():
    return join("cat", manual=True)


def test_one_persons_broken_ledger_does_not_stop_prices_for_the_rest(client, monkeypatch):
    join("ann", manual=False)
    ben = join("ben", manual=False)
    source = CountingSource()
    monkeypatch.setattr(price_sync, "provider_for", lambda _: source)
    account = new_account(ben, name="ben checking")
    spent = transaction(ben, account, amount="50.00", date=str(TODAY))["id"]
    with ledger_of("ann") as db:
        db.execute(text("UPDATE users SET preferences='not json'"))
        db.commit()
    price_sync.tick()
    with ledger_of("ben") as db:
        assert db.get(ExpenseCost, spent) is not None


def test_starting_a_ledger_is_throttled_like_sign_in(client):
    join("ann")
    stranger = TestClient(app)
    for n in range(10):
        reply = stranger.post("/api/auth/setup", json={"username": "ann", "password": "x"})
        assert reply.status_code == 409 and "already used" in reply.json()["detail"]
    assert stranger.post("/api/auth/setup", json={"username": "new", "password": "x"}).status_code == 429


def test_no_request_code_reaches_for_a_default_ledger():
    """Only the data layer and startup may name the first ledger; everything else gets the signed-in person's."""
    allowed = {"db.py", "startup.py"}
    for source in (Path(__file__).resolve().parents[1] / "app").glob("*.py"):
        if source.name in allowed:
            continue
        code = source.read_text()
        assert "SessionLocal" not in code, source.name
        assert not re.search(r"from \.db import[^\n]*\bengine\b", code), source.name
        assert "FIRST_LEDGER" not in code, source.name


def all_rows(path, skip=()):
    with sqlite3.connect(path) as conn:
        tables = [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
        return {
            table: list(conn.execute(f"SELECT * FROM {table} ORDER BY 1, 2")) for table in tables if table not in skip
        }


def test_the_existing_ledger_becomes_the_first_persons_with_nothing_lost(owner):
    """A populated ledger from before this change, upgraded where it stands."""
    assert owner.post("/api/demo").status_code == 200  # five years of the fictional person
    checking = next(a["id"] for a in owner.get("/api/accounts").json() if a["kind"] == "checking")
    spend = transaction(owner, checking, amount="19.99", date=str(TODAY), description="Corrected later")
    owner.put(
        f"/api/transactions/{spend['id']}",
        json={
            "date": str(TODAY),
            "kind": "expense",
            "account_id": checking,
            "category_id": spend["category_id"],
            "amount": "21.99",
            "description": "Corrected",
        },
    )
    owner.put("/api/settings/monetary-lens", json={"denomination": "BITCOIN"})
    journal = owner.get("/api/export/journal").text
    answers = read_everything(owner)

    # Put the file back the way the single-owner version left it: the password, the sessions
    # and the sign-in attempts inside the ledger, and no shared file at all.
    path = Path(engine.url.database)
    old_hash = person("owner").password_hash
    for made in app_db._ledgers.values():
        made.dispose()
    app_db.people_engine.dispose()
    PEOPLE_FILE.unlink()
    with sqlite3.connect(path) as conn:
        conn.execute("UPDATE users SET password_hash=?", (old_hash,))
        conn.execute(
            "CREATE TABLE sessions (token_hash VARCHAR(64) NOT NULL PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users (id), csrf VARCHAR NOT NULL, expires BIGINT NOT NULL)"
        )
        conn.execute(
            "CREATE TABLE login_attempts (id INTEGER NOT NULL PRIMARY KEY, client VARCHAR NOT NULL, at BIGINT NOT NULL)"
        )
        conn.execute("INSERT INTO sessions VALUES ('old', 1, 'old', 9999999999)")
        # Income sources came later still; a ledger of that time had none of their tables.
        for table in ("income_entry_sources", "income_source_names", "income_sources"):
            conn.execute(f"DROP TABLE {table}")
        conn.execute("ALTER TABLE income_schedules DROP COLUMN source_id")
        conn.execute("UPDATE alembic_version SET version_num='0015_income_varies'")
    gone = (
        "sessions",
        "login_attempts",
        "alembic_version",
        "income_entry_sources",
        "income_source_names",
        "income_sources",
    )
    before = all_rows(path, skip=gone)
    assert len(before["journal_entries"]) > 3000 and len(before["exchange_rates"]) > 1500
    assert before["expense_costs"] and before["audit_events"] and before["recurring_bills"]

    ensure_schema()

    after = all_rows(path, skip=gone)
    users_before, users_after = before.pop("users"), after.pop("users")
    # Pay schedules gained one empty column; everything they held is unchanged.
    schedules = after.pop("income_schedules")
    assert [row[:-1] for row in schedules] == before.pop("income_schedules") and all(
        row[-1] is None for row in schedules
    )
    assert after == before  # every entry, price, cost record, bill and audit event
    # The settings row is the same but for the password, which moved to the shared file.
    assert [row[:2] + row[3:] for row in users_after] == [row[:2] + row[3:] for row in users_before]
    assert users_after[0][2] == "" and person("owner").password_hash == old_hash
    assert person("owner").ledger == path.name
    kept = path.with_name(path.stem + ".before-people.db")
    assert all_rows(kept, skip=(*gone, "income_schedules")) == before | {"users": users_before}
    with sqlite3.connect(path) as conn:
        assert conn.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert list(conn.execute("PRAGMA foreign_key_check")) == []
        with pytest.raises(sqlite3.DatabaseError):
            conn.execute("UPDATE postings SET amount_minor = amount_minor + 1")

    ensure_schema()  # starting again changes nothing
    assert all_rows(path, skip=gone) == after | {"users": users_after, "income_schedules": schedules}
    with TestClient(app) as restarted:
        assert restarted.get("/api/accounts").status_code == 401  # the old session did not come along
        signed = restarted.post(
            "/api/auth/login", json={"username": "owner", "password": "correct-horse-battery-staple"}
        )
        assert signed.status_code == 200
        restarted.headers["X-CSRF-Token"] = signed.json()["csrf"]
        assert restarted.get("/api/export/journal").text == journal
        again = read_everything(restarted)
        for url in answers:
            # Income sources did not exist in the old version; they are made on first read.
            if url not in (
                "/api/audit",
                "/api/auth/me",
                "/api/backup/status",
                "/api/alerts",
                "/api/dashboard",
                "/api/income",
            ):
                assert again[url] == answers[url], url
        assert restarted.get("/api/settings").json()["preferences"]["denomination"] == "BITCOIN"
        # And a second person can start beside it.
        other = join("ben")
        assert other.get("/api/accounts").json() == []
        assert all_rows(path, skip=gone)["journal_entries"] == after["journal_entries"]
