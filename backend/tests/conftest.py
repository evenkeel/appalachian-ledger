import os
import tempfile
from pathlib import Path

TEST_DIR = tempfile.TemporaryDirectory()
os.environ["DATABASE_URL"] = "sqlite:///" + str(Path(TEST_DIR.name) / "ledger.db")
os.environ["DEMO_ENABLED"] = "true"
os.environ["APP_ORIGIN"] = "http://testserver"
os.environ["PRICE_WORKER_ENABLED"] = "false"

import pytest  # noqa: E402
from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import json  # noqa: E402
from sqlalchemy import select  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.models import User  # noqa: E402
from app.main import app  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True)
def database():
    engine.dispose()
    Path(engine.url.database).unlink(missing_ok=True)
    command.upgrade(Config(str(ROOT / "database/alembic.ini")), "head")
    yield
    engine.dispose()


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture
def owner(client):
    result = client.post("/api/auth/setup", json={"username": "owner", "password": "correct-horse-battery-staple"})
    assert result.status_code == 200, result.text
    client.headers["X-CSRF-Token"] = result.json()["csrf"]
    # A new owner starts on Coinbase prices. Most tests price by hand, so they start on manual
    # prices and never reach the network; test_prices covers the Coinbase start itself.
    with SessionLocal() as db:
        user = db.scalar(select(User))
        user.preferences = json.dumps(json.loads(user.preferences) | {"rate_source": "manual", "automatic_prices": False})
        db.commit()
    return client


@pytest.fixture
def coinbase_owner(client):
    """An owner exactly as setup leaves them: Coinbase prices, fetched automatically."""
    result = client.post("/api/auth/setup", json={"username": "owner", "password": "correct-horse-battery-staple"})
    assert result.status_code == 200, result.text
    client.headers["X-CSRF-Token"] = result.json()["csrf"]
    return client


def post(client, url, data):
    result = client.post("/api" + url, json=data)
    assert result.status_code == 200, result.text
    return result.json()


def new_account(client, name="Checking", currency="USD", amount="1000", kind="checking"):
    return post(
        client,
        "/accounts",
        {"name": name, "currency": currency, "opening_balance": amount, "kind": kind, "date": "2026-01-01"},
    )["id"]


def category(client, kind):
    return next(c["id"] for c in client.get("/api/categories").json() if c["kind"] == kind)


def transaction(client, account, kind="expense", amount="12.00", **kw):
    payload = {"date": "2026-01-05", "kind": kind, "account_id": account, "amount": amount, "description": "Test entry"}
    if kind != "transfer":
        payload["category_id"] = category(client, kind)
    payload.update(kw)
    return post(client, "/transactions", payload)
