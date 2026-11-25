import sqlite3
from app.db import engine
from conftest import new_account, transaction


def test_auth_csrf_and_origin(client):
    assert client.get("/api/accounts").status_code == 401
    assert client.post("/api/auth/setup", json={"username": "owner", "password": "short"}).status_code == 422
    response = client.post("/api/auth/setup", json={"username": "owner", "password": "secure-long-password"})
    assert response.status_code == 200
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert client.post("/api/auth/logout").status_code == 403
    assert (
        client.post(
            "/api/auth/logout", headers={"X-CSRF-Token": response.json()["csrf"], "Origin": "http://evil.example"}
        ).status_code
        == 403
    )
    assert client.get("/api/accounts", headers={"Host": "attacker.example"}).status_code == 400
    assert (
        client.post("/api/auth/setup", json={"username": "other", "password": "secure-long-password"}).status_code
        == 409
    )
    assert client.post("/api/auth/logout", headers={"X-CSRF-Token": response.json()["csrf"]}).status_code == 200
    assert client.get("/api/accounts").status_code == 401
    assert client.post("/api/auth/login", json={"username": "owner", "password": "wrong"}).status_code == 401
    assert (
        client.post("/api/auth/login", json={"username": "owner", "password": "secure-long-password"}).status_code
        == 200
    )


def test_login_throttle_persists(client):
    for _ in range(10):
        assert client.post("/api/auth/login", json={"username": "nobody", "password": "wrong"}).status_code == 401
    assert client.post("/api/auth/login", json={"username": "nobody", "password": "wrong"}).status_code == 429


def test_csv_duplicates_and_atomic_failure(owner):
    checking = new_account(owner)
    content = b"date,kind,amount,description,category,external_id\n2026-01-05,expense,10.00,Lunch,Dining,row-1\n"

    def upload(body):
        return owner.post(
            "/api/import/csv", data={"account_id": checking}, files={"file": ("transactions.csv", body, "text/csv")}
        )

    assert upload(content).json() == {"imported": 1, "duplicates": 0}
    assert upload(content).json() == {"imported": 0, "duplicates": 1}
    invalid = content + b"2026-01-06,expense,2,Good,Dining,row-2\n2026-01-07,expense,3,Bad,Does not exist,row-3\n"
    assert upload(invalid).status_code == 422
    assert len(owner.get("/api/transactions").json()) == 1
    identical = b"date,kind,amount,description,category\n2026-01-08,expense,5,Coffee,Dining\n2026-01-08,expense,5,Coffee,Dining\n"
    assert upload(identical).json() == {"imported": 2, "duplicates": 0}
    assert upload(identical).json() == {"imported": 0, "duplicates": 2}


def test_backup_restore_integrity_and_reauthentication(owner):
    checking = new_account(owner)
    transaction(owner, checking, amount="20")
    passphrase = "long-backup-passphrase"
    exported = owner.post("/api/backup", json={"passphrase": passphrase})
    assert exported.status_code == 200
    assert b"Checking" not in exported.content
    transaction(owner, checking, amount="30")
    before = owner.get("/api/accounts").json()[0]["balance"]

    def restore(content, password):
        return owner.post(
            "/api/restore",
            data={"passphrase": password},
            files={"file": ("ledger.albackup", content, "application/octet-stream")},
        )

    assert restore(exported.content, "wrong-password-long").status_code == 422
    assert owner.get("/api/accounts").json()[0]["balance"] == before
    damaged = bytearray(exported.content)
    damaged[-1] ^= 1
    assert restore(bytes(damaged), passphrase).status_code == 422
    result = restore(exported.content, passphrase)
    assert result.status_code == 200, result.text
    assert owner.get("/api/accounts").status_code == 401
    response = owner.post("/api/auth/login", json={"username": "owner", "password": "correct-horse-battery-staple"})
    assert response.status_code == 200
    owner.headers["X-CSRF-Token"] = response.json()["csrf"]
    assert owner.get("/api/accounts").json()[0]["balance"] == "980.00"
    assert len(owner.get("/api/transactions").json()) == 1
    with sqlite3.connect(engine.url.database) as db:
        assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert not list(db.execute("PRAGMA foreign_key_check"))


def test_export_neutralizes_spreadsheet_formulas(owner):
    checking = new_account(owner)
    transaction(owner, checking, description='=HYPERLINK("evil")')
    result = owner.get("/api/export/csv")
    assert result.status_code == 200
    assert "'=HYPERLINK" in result.text
    journal = owner.get("/api/export/journal").json()
    assert any(row["kind"] == "opening" for row in journal)


def test_demo_is_functional_offline(owner, monkeypatch):
    import httpx

    def no_network(*args, **kwargs):
        raise AssertionError("Loading the demo must not use the network")

    monkeypatch.setattr(httpx, "Client", no_network)
    result = owner.post("/api/demo?months=6")
    assert result.status_code == 200, result.text
    assert result.json()["prices"] == "Coinbase daily close"
    assert len(owner.get("/api/accounts").json()) == 4
    assert len(owner.get("/api/transactions").json()) >= 300
    report = owner.get("/api/reports").json()
    # With no network there is no current quote, and none is made up.
    assert report["rate"] is None
    assert len(report["history"]) == 6
    assert owner.get("/api/auth/me").json()["demo"] is True
    settings = owner.get("/api/settings").json()["preferences"]
    assert settings["rate_source"] == "coinbase" and settings["automatic_prices"] is True
    assert owner.post("/api/demo").status_code == 422


def test_expired_session_and_password_revocation(owner):
    response = owner.post(
        "/api/auth/password",
        json={"current_password": "correct-horse-battery-staple", "new_password": "a-new-secure-owner-password"},
    )
    assert response.status_code == 200
    assert owner.post("/api/auth/logout").status_code == 403  # old CSRF is revoked
    owner.headers["X-CSRF-Token"] = response.json()["csrf"]
    assert owner.get("/api/accounts").status_code == 200
    with sqlite3.connect(engine.url.database) as db:
        db.execute("UPDATE sessions SET expires=1")
    assert owner.get("/api/accounts").status_code == 401
    assert (
        owner.post(
            "/api/auth/login", json={"username": "owner", "password": "correct-horse-battery-staple"}
        ).status_code
        == 401
    )
    assert (
        owner.post("/api/auth/login", json={"username": "owner", "password": "a-new-secure-owner-password"}).status_code
        == 200
    )


def test_authenticated_but_incompatible_backup_is_rejected(owner):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from app.backup import MAGIC, key

    new_account(owner)
    phrase = "schema-check-passphrase"
    payload = owner.post("/api/backup", json={"passphrase": phrase}).content
    pos = len(MAGIC)
    salt, nonce = payload[pos : pos + 16], payload[pos + 16 : pos + 28]
    cipher = AESGCM(key(phrase, salt))
    plain = cipher.decrypt(nonce, payload[pos + 28 :], MAGIC)
    with sqlite3.connect(":memory:") as db:
        db.deserialize(plain)
        db.execute("CREATE TABLE unexpected (id INTEGER)")
        modified = db.serialize()
    altered = MAGIC + salt + nonce + cipher.encrypt(nonce, modified, MAGIC)
    result = owner.post(
        "/api/restore",
        data={"passphrase": phrase},
        files={"file": ("bad.albackup", altered, "application/octet-stream")},
    )
    assert result.status_code == 422
    assert "schema" in result.json()["detail"]
    assert owner.get("/api/accounts").json()[0]["balance"] == "1000.00"


def test_database_permissions_are_owner_only(owner):
    import os
    import stat

    assert stat.S_IMODE(os.stat(engine.url.database).st_mode) == 0o600
