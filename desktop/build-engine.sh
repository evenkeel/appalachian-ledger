#!/bin/sh
# Build the interface and freeze the Python engine into desktop/engine-dist/ledger-engine.
set -eu
cd "$(dirname "$0")/.."
npm --prefix frontend run build
if [ ! -x desktop/.build-venv/bin/python ]; then
  # A standard CPython (Homebrew or python.org). Some standalone Python builds freeze
  # without a working OpenSSL, which breaks price updates in the bundle.
  PYTHON=${PYTHON:-$(command -v /opt/homebrew/opt/python@3.12/bin/python3.12 || command -v python3.12)}
  "$PYTHON" -m venv desktop/.build-venv
  desktop/.build-venv/bin/pip install -q -r backend/requirements.txt pyinstaller==6.22.3
fi
find database/migrations -name __pycache__ -prune -exec rm -rf {} +
desktop/.build-venv/bin/pyinstaller --noconfirm --clean --log-level WARN \
  --distpath desktop/engine-dist --workpath desktop/.engine-build desktop/engine.spec
