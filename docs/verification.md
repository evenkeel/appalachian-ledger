# Source publication verification — November 15, 2026

The latest source was checked before its initial sanitized GitHub publication.
All database checks used isolated temporary databases.

- Backend: **226 tests passed**.
- Frontend: **230 tests passed across 40 files**.
- Ruff lint and formatting checks: passed.
- TypeScript and production Vite build: passed.
- Alembic upgrade and schema drift check: passed on a new temporary database.

The backend suite reports a Starlette/httpx deprecation warning. The production
build reports a bundle-size advisory. Neither caused a check failure.
Docker is unavailable in the local verification environment; container builds
and HTTP/HTTPS deployment smoke checks are defined in GitHub Actions.
External price providers and Bitcoin Core are mocked in the automated suite;
live integration and real-device deployment checks are not claimed here.

Historical local screenshots and machine-specific session notes are intentionally
excluded. See [source privacy](source-privacy.md) for publication boundaries and
safe remote development.
