# Desktop app

A normal Mac program (Windows to follow) that people download, double-click and use.
It does not need Docker, Python or a terminal.

## How it works

- `engine.py` starts the same Python engine the Docker install runs, on one local
  port (47821, or a free one if that is taken). It serves the API and the built interface.
- PyInstaller freezes the engine, its migrations and `frontend/dist` into
  `engine-dist/ledger-engine` (`engine.spec`, run by `build-engine.sh`).
- A small Tauri program (`src-tauri/`) shows a loading screen, starts the engine, waits
  until it answers and then opens the ledger in the app's own window. Quitting the app
  closes the engine's input, and it stops cleanly.
- The ledger lives in the computer's app-data folder:
  `~/Library/Application Support/com.appalachianbitcoin.desktop/` on a Mac
  (`ledger.db`, plus `engine.log` for problems). Only one copy can run at a time.

## Build (Mac)

Needs Node, Rust (`brew install rustup && rustup-init`) and a standard Python 3.12
(`brew install python@3.12`). Some standalone Python builds freeze without working
OpenSSL, which breaks live prices.

```sh
cd desktop
npm install
npm run build
```

The app and the `.dmg` land in `src-tauri/target/release/bundle/`. It is not signed
yet, so the first open needs System Settings → Privacy & Security → Open Anyway.

`npm run icons` remakes the app icons from `icon.svg`.
