#!/usr/bin/env python3
"""Manage the login-time local ledger on macOS, without Docker or a terminal."""

import argparse
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
LABEL = "com.appalachianbitcoin.ledger"
PLIST = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
DOMAIN = f"gui/{os.getuid()}"
SERVICE = f"{DOMAIN}/{LABEL}"


def definition():
    return {
        "Label": LABEL,
        "ProgramArguments": [
            str(ROOT / ".venv/bin/python"),
            "-m",
            "uvicorn",
            "app.beta:app",
            "--host",
            "127.0.0.1",
            "--port",
            "5173",
            "--no-access-log",
        ],
        "WorkingDirectory": str(ROOT),
        "EnvironmentVariables": {
            "PYTHONPATH": str(ROOT / "backend"),
            "DATABASE_URL": "sqlite:///" + str(ROOT / "data/testing.db"),
            "APP_ORIGIN": "http://localhost:5173,http://127.0.0.1:5173",
            "ALLOWED_HOSTS": "localhost,127.0.0.1",
            "COOKIE_SECURE": "false",
            "DEMO_ENABLED": "false",
            "PRICE_WORKER_ENABLED": "true",
            "PYTHONUNBUFFERED": "1",
            "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
        },
        "RunAtLoad": True,
        "KeepAlive": True,
        "ThrottleInterval": 10,
        "Umask": 0o077,
        "StandardOutPath": str(ROOT / "data/server.log"),
        "StandardErrorPath": str(ROOT / "data/server-error.log"),
    }


def launchctl(*args, check=True):
    return subprocess.run(["/bin/launchctl", *args], check=check)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("install", "status", "restart", "uninstall", "print"))
    args = parser.parse_args()
    if sys.platform != "darwin":
        parser.error("This helper is for macOS.")
    if args.action == "print":
        sys.stdout.buffer.write(plistlib.dumps(definition()))
    elif args.action == "install":
        for required in (ROOT / ".venv/bin/python", ROOT / "frontend/dist/index.html"):
            if not required.exists():
                parser.error(f"Missing {required}. Install dependencies and build the frontend first.")
        (ROOT / "data").mkdir(exist_ok=True)
        PLIST.parent.mkdir(parents=True, exist_ok=True)
        if PLIST.exists() and plistlib.loads(PLIST.read_bytes()).get("WorkingDirectory") != str(ROOT):
            parser.error("An existing service uses a different checkout; remove it explicitly before installing.")
        PLIST.write_bytes(plistlib.dumps(definition()))
        PLIST.chmod(0o600)
        launchctl("bootout", SERVICE, check=False)
        launchctl("enable", SERVICE)
        launchctl("bootstrap", DOMAIN, str(PLIST))
        print("Installed. Open http://localhost:5173. The ledger starts when you log in.")
    elif args.action == "status":
        launchctl("print", SERVICE)
    elif args.action == "restart":
        launchctl("kickstart", "-k", SERVICE)
    else:
        launchctl("bootout", SERVICE, check=False)
        PLIST.unlink(missing_ok=True)
        print("Automatic startup removed. Your ledger and backups are retained.")


if __name__ == "__main__":
    main()
