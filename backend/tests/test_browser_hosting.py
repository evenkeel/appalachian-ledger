"""The setup helper must keep local access local and network access exact."""

import importlib.util
from pathlib import Path

import pytest

spec = importlib.util.spec_from_file_location("hosting", Path(__file__).resolve().parents[2] / "scripts/host.py")
hosting = importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosting)


def test_computer_is_loopback_only():
    values, url = hosting.configuration("computer")
    assert values["BIND_ADDRESS"] == "127.0.0.1"
    assert values["APP_ORIGIN"] == "http://localhost:8080,http://127.0.0.1:8080"
    assert url == "http://localhost:8080"
    with pytest.raises(ValueError):
        hosting.configuration("computer", bind="0.0.0.0")


def test_node_uses_https_and_exact_origin():
    values, url = hosting.configuration("node", "192.168.1.20", "ledger.home.arpa")
    assert values["COOKIE_SECURE"] == "true"
    assert values["APP_ORIGIN"] == url == "https://ledger.home.arpa:8443"
    assert values["ALLOWED_HOSTS"] == "localhost,127.0.0.1,ledger.home.arpa"
    assert hosting.compose_command("node", Path("settings.env"))[-1] == "deployment/private.compose.yml"
    assert hosting.configuration("node", "10.0.0.2", port=443)[1] == "https://10.0.0.2"


@pytest.mark.parametrize("bind", ["0.0.0.0", "127.0.0.1", "8.8.8.8", "169.254.1.2", "::1", "", "10.0.0.2\nX=1"])
def test_node_rejects_nonprivate_interfaces(bind):
    with pytest.raises(ValueError):
        hosting.configuration("node", bind)


@pytest.mark.parametrize("host", ["*", "example.com", "https://ledger.local", "ledger.local/path", "a.local\nX=1"])
def test_node_rejects_unsafe_host_values(host):
    with pytest.raises(ValueError):
        hosting.configuration("node", "192.168.1.20", host)


@pytest.mark.parametrize("port", [0, -1, 65536])
def test_invalid_ports(port):
    with pytest.raises(ValueError):
        hosting.configuration("computer", port=port)


def test_setup_does_not_replace_existing_config(tmp_path):
    import subprocess
    import sys

    config = tmp_path / "hosting.env"
    command = [sys.executable, str(ROOT_SCRIPT), "computer", "--config", str(config)]
    assert subprocess.run(command, capture_output=True).returncode == 0
    original = config.read_bytes()
    result = subprocess.run(command, capture_output=True)
    assert result.returncode != 0
    assert b"already exists" in result.stderr
    assert config.read_bytes() == original


ROOT_SCRIPT = Path(hosting.__file__)


def test_https_session_accepts_its_origin_and_rejects_other_origins(monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import app

    monkeypatch.setenv("COOKIE_SECURE", "true")
    monkeypatch.setenv("APP_ORIGIN", "https://testserver:8443")
    with TestClient(app, base_url="https://testserver:8443") as client:
        result = client.post(
            "/api/auth/setup",
            json={"username": "owner", "password": "secure-long-password"},
            headers={"Origin": "https://testserver:8443"},
        )
        assert result.status_code == 200
        assert "; Secure" in result.headers["set-cookie"]
        assert client.get("/api/accounts").status_code == 200
        headers = {"X-CSRF-Token": result.json()["csrf"], "Origin": "http://testserver:8443"}
        assert client.post("/api/auth/logout", headers=headers).status_code == 403
        headers["Origin"] = "https://testserver:8443"
        assert client.post("/api/auth/logout", headers=headers).status_code == 200
