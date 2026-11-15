.PHONY: test lint migrate dev-backend dev-frontend
PYTHON ?= .venv/bin/python

test:
	$(PYTHON) -m pytest -q
	cd frontend && npm test

lint:
	$(PYTHON) -m ruff check backend database
	$(PYTHON) -m ruff format --check backend database
	cd frontend && npm run lint

migrate:
	$(PYTHON) -m alembic -c database/alembic.ini upgrade head

dev-backend: migrate
	APP_ORIGIN=http://localhost:5173,http://127.0.0.1:5173 PYTHONPATH=backend $(PYTHON) -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log --reload --reload-dir backend/app --reload-dir database/migrations

dev-frontend:
	cd frontend && npm run dev
