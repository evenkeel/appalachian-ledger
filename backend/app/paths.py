"""Where the code finds its own files: migrations and the built interface.

A source checkout keeps them beside `backend/`. The desktop app bundles them elsewhere
and says where with LEDGER_ROOT.
"""

import os
from pathlib import Path

ROOT = Path(os.getenv("LEDGER_ROOT") or Path(__file__).resolve().parents[2])
ALEMBIC_INI = ROOT / "database" / "alembic.ini"
FRONTEND = ROOT / "frontend" / "dist"
