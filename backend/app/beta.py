"""Serve the built beta and API together on one local port."""

from fastapi.staticfiles import StaticFiles
from .main import app
from .paths import FRONTEND as frontend

if not (frontend / "index.html").is_file():
    raise RuntimeError("Build the frontend first: npm --prefix frontend run build")

# Mount after API routes. Only the compiled public frontend is served.
app.mount("/", StaticFiles(directory=frontend, html=True), name="beta")
