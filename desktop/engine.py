"""Start the ledger's engine for the desktop app.

The desktop window starts this program and talks to it on one local port. The ledger
lives in the data folder the window passes in. When the window closes, our standard
input closes too, and the engine stops cleanly.
"""

import argparse
import os
import sys
import threading
from pathlib import Path


def hold_lock(folder: Path):
    """Allow one engine per data folder: two writers on one database would corrupt it."""
    handle = open(folder / "engine.lock", "a+")
    try:
        if sys.platform == "win32":
            import msvcrt

            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl

            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("Another copy of the app is already using these ledgers.", file=sys.stderr)
        sys.exit(3)
    return handle


def stop_when_window_closes(server):
    def watch():
        try:
            while sys.stdin.read(4096):
                pass
        finally:
            server.should_exit = True

    threading.Thread(target=watch, daemon=True, name="window-watch").start()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--data-dir", type=Path, required=True)
    args = parser.parse_args()

    os.umask(0o077)
    data = args.data_dir.expanduser().resolve()
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    if sys.platform != "win32":
        data.chmod(0o700)  # the window may have made the folder already, with looser defaults
        # Every person's ledger, the shared sign-in file and the log are for this user only.
        for file in [data / "engine.log", *data.glob("*.db"), *data.glob("ledgers/*.db")]:
            if file.exists():
                file.chmod(0o600)
    lock = hold_lock(data)  # noqa: F841 (held until exit)

    # Bundled: PyInstaller unpacks migrations and the interface under sys._MEIPASS.
    root = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[1]))
    origin = f"http://127.0.0.1:{args.port}"
    os.environ.update(
        LEDGER_ROOT=str(root),
        DATABASE_URL="sqlite:///" + str(data / "ledger.db"),
        APP_ORIGIN=f"{origin},http://localhost:{args.port}",
        ALLOWED_HOSTS="127.0.0.1,localhost",
        COOKIE_SECURE="false",
    )
    os.environ.setdefault("DEMO_ENABLED", "false")

    import uvicorn

    from app.beta import app  # after the environment is set: app.db reads it on import

    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=args.port, workers=1, access_log=False, log_level="warning")
    )
    stop_when_window_closes(server)
    print(f"Engine starting on {origin}", flush=True)
    server.run()


if __name__ == "__main__":
    main()
