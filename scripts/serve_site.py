"""Serve the built website from `website/dist` on this computer, to look at it before it goes live.

    python3 scripts/serve_site.py [port]

Then open http://127.0.0.1:5214/ (the demo is under /demo/). Plain files only; nothing is
recorded. Python's one-line file server drops requests when a page asks for many files at once,
which the demo does, so this one keeps a longer queue.
"""

import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

SITE = Path(__file__).resolve().parents[1] / "website" / "dist"


class Server(ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5214
    if not SITE.is_dir():
        raise SystemExit("Nothing to serve yet. Build the site first: make website")
    print(f"Serving {SITE} at http://127.0.0.1:{port}/  (Ctrl+C to stop)")
    Server(("127.0.0.1", port), partial(Quiet, directory=str(SITE))).serve_forever()
