.PHONY: test lint migrate dev-backend dev-frontend demo-prices web-demo website site-preview
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

# Fetch the newest real Coinbase daily closes for the demo and move its five-year window forward.
demo-prices:
	PYTHONPATH=backend $(PYTHON) scripts/demo_prices.py

# The website's browser demo: refresh prices, save the real server's answers about the fictional
# ledger, check that the browser adds them up exactly as the server does, and build it.
web-demo:
	PYTHONPATH=backend $(PYTHON) scripts/web_demo.py
	cd frontend && npx vitest run src/demo && npm run build:demo

# The whole website into website/dist: its pages and the browser demo.
website: web-demo
	$(PYTHON) scripts/build_site.py

site-preview:
	$(PYTHON) scripts/serve_site.py
