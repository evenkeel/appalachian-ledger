#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
export DATABASE_URL="sqlite:///./data/testing.db"
export APP_ORIGIN="http://localhost:5173,http://127.0.0.1:5173"
export DEMO_ENABLED=false
export PRICE_WORKER_ENABLED=true
export PYTHONPATH=backend
npm --prefix frontend run build
.venv/bin/alembic -c database/alembic.ini upgrade head
exec .venv/bin/uvicorn app.beta:app --host 127.0.0.1 --port 5173 --no-access-log \
  --reload --reload-dir backend/app --reload-dir database/migrations
