# Appalachian Bitcoin

A personal finance manager that runs on your own computer. Track your paychecks, bills and
spending, and switch between dollars and bitcoin as the measuring stick. No cloud account, no
tracking. It's in beta.

Website and demo: [appalachianbitcoin.com](https://appalachianbitcoin.com)

## Install

**Mac (Apple silicon, macOS 11+):** download the app from
[Releases](https://github.com/evenkeel/appalachian-ledger/releases). It isn't signed yet, so the
first time you open it, go to System Settings → Privacy & Security and click Open Anyway.

**Windows and Intel Macs:** a Windows app is coming. For now, use Docker:

```sh
cp .env.example .env
docker compose up --build -d
```

Then open [localhost:8080](http://localhost:8080).

Make backups in Settings and keep them off your computer.

## Develop

Needs Python 3.12 and Node 24.

```sh
python3.12 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
npm --prefix frontend ci
make dev-backend     # in one terminal
make dev-frontend    # in another, then open 127.0.0.1:5173
make test
```

The Mac app build is described in [desktop/README.md](desktop/README.md), and the website in
[website/README.md](website/README.md). More notes are in [docs/](docs/).

MIT License. See [LICENSE](LICENSE).
