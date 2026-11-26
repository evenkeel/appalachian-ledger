# PyInstaller recipe for the bundled engine: `desktop/build-engine.sh` runs it.
# Migrations stay as source files: Alembic reads them from disk at startup.
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).parent

a = Analysis(
    [str(ROOT / "desktop" / "engine.py")],
    pathex=[str(ROOT / "backend")],
    datas=[
        (str(ROOT / "database" / "alembic.ini"), "database"),
        (str(ROOT / "database" / "migrations"), "database/migrations"),
        (str(ROOT / "frontend" / "dist"), "frontend/dist"),
        (str(ROOT / "backend" / "app" / "demo_data"), "app/demo_data"),
    ],
    hiddenimports=[
        *collect_submodules("app"),
        *collect_submodules("uvicorn"),
        *collect_submodules("alembic", filter=lambda name: ".testing" not in name),
        "sqlalchemy.dialects.sqlite",
    ],
    excludes=["tkinter", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="ledger-engine", console=True, strip=False, upx=False)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="ledger-engine")
