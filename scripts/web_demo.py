"""Save the answers the website demo is served from.

The website demo is the real interface with no server behind it. This script loads the
fictional demo into a throwaway ledger, asks the real server every question the interface asks,
and saves the answers as files in `frontend/demo-public/demo-data/`. `npm run build:demo` then
packs the interface and those files into `website/dist/demo/`. `make web-demo` runs the whole
chain, so one command brings the website demo level with the app.

    PYTHONPATH=backend .venv/bin/python scripts/web_demo.py            # refresh prices first
    PYTHONPATH=backend .venv/bin/python scripts/web_demo.py --offline  # use the saved price file

Nothing here reads or writes a real ledger: the database is a new file in a temporary folder.
The current price in the demo is one real Coinbase quote taken by the price refresh, saved
with its time. With --offline that quote may be days old; it is still shown with its own time.
"""

import argparse
import json
import os
import secrets
import shutil
import sys
import tempfile
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "frontend" / "demo-public"
PUBLIC = ROOT / "frontend" / "public"

# Read once when the demo opens. Everything else is fetched when a screen first needs it.
CORE = [
    "/auth/me",
    "/dashboard",
    "/alerts",
    "/settings",
    "/settings/alert-thresholds",
    "/categories",
    "/accounts",
    "/income-schedules",
    "/recurring-bills",
    "/recurring-bills/destroyed",
    "/prices/status",
    "/prices/conversions",
    "/backup/status",
    "/planning/starting-position",
    "/planning/scenarios",
    "/assets",
]
# Larger answers that only one corner of the interface reads.
LAZY = {"/rates": "rates", "/audit": "audit", "/stack/history": "stack-history"}


def month_keys(first: date, last: date):
    index, end = first.year * 12 + first.month - 1, last.year * 12 + last.month - 1
    return [f"{i // 12:04d}-{i % 12 + 1:02d}" for i in range(index, end + 1)]


def month_end(month: str, today: date) -> date:
    year, number = int(month[:4]), int(month[5:])
    following = date(year + (number == 12), number % 12 + 1, 1)
    return min(following - timedelta(days=1), today)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument(
        "--offline", action="store_true", help="do not refresh prices; use the saved price file as it is"
    )
    parser.add_argument("--out", type=Path, default=OUT)
    args = parser.parse_args()

    # The throwaway ledger is chosen before anything from the app is imported. The app decides
    # where its database is the moment it is first imported, and its default is ./data/ledger.db,
    # which on an owner's machine may be a real ledger.
    work = tempfile.TemporaryDirectory()
    database = Path(work.name).resolve() / "demo.db"
    os.environ.update(
        DATABASE_URL=f"sqlite:///{database}",
        DEMO_ENABLED="true",
        PRICE_WORKER_ENABLED="false",
        APP_ORIGIN="http://testserver",
    )
    from app.db import engine

    if Path(engine.url.database).resolve() != database:
        raise SystemExit(f"Refusing to run: the app opened {engine.url.database}, not the throwaway ledger.")

    if not args.offline:
        sys.path.insert(0, str(ROOT / "scripts"))
        import demo_prices

        if demo_prices.main():
            return 1

    from alembic import command
    from alembic.config import Config
    from fastapi.testclient import TestClient

    import app.accounting
    import app.alerts
    import app.price_sync
    import app.prices
    from app.db import SessionLocal
    from app.demo_life import load_prices
    from app.main import app as server
    from app.models import PriceQuote

    command.upgrade(Config(str(ROOT / "database" / "alembic.ini")), "head")
    prices = load_prices()
    quote = prices.quote
    today = date.today()
    captured = datetime.now(timezone.utc)

    with TestClient(server) as client:

        def ask(path, method="GET", **kwargs):
            reply = client.request(method, "/api" + path, **kwargs)
            if reply.status_code != 200:
                raise SystemExit(f"{method} {path} answered {reply.status_code}: {reply.text[:300]}")
            return reply.json()

        owner = ask("/auth/setup", "POST", json={"username": "demo", "password": secrets.token_urlsafe(24)})
        client.headers["X-CSRF-Token"] = owner["csrf"]
        loaded = ask("/demo", "POST")
        settings = ask("/settings")["preferences"]
        ask("/settings", "PUT", json=settings | {"theme": "light"})

        if quote:
            observed = datetime.fromisoformat(quote["observed_at"])
            with SessionLocal() as db:
                db.merge(
                    PriceQuote(
                        source=prices.source,
                        usd_per_btc=quote["usd_per_btc"],
                        observed_at=quote["observed_at"],
                        fetched_at=quote["observed_at"],
                    )
                )
                db.commit()
            if captured - observed > timedelta(minutes=9):
                print(f"Using the saved quote from {quote['observed_at']}; run without --offline for a fresh one.")
            # The demo's clock for prices is the moment its quote was taken: the ledger reads the
            # quote as current however long this script takes, and the demo labels it with that time.
            moment = observed + timedelta(seconds=30)

            class QuoteTime(datetime):
                @classmethod
                def now(cls, tz=None):
                    return moment

            for module in (app.prices, app.accounting, app.price_sync):
                module.utcnow = lambda: moment
            app.alerts.datetime = QuoteTime
            captured = observed

        data = args.out / "demo-data"
        if data.exists():
            shutil.rmtree(data)
        for folder in ("reports", "spending", "activity"):
            (data / folder).mkdir(parents=True)
        # He keeps a backup, like anyone settled into the app, so the demo opens on his money
        # and not on a reminder. The backup itself is discarded with the throwaway ledger.
        made = client.post("/api/backup", json={"passphrase": secrets.token_urlsafe(24)})
        if made.status_code != 200:
            raise SystemExit(f"The demo ledger's backup failed: {made.status_code} {made.text[:200]}")

        def save(name, value):
            (data / f"{name}.json").write_text(json.dumps(value, separators=(",", ":")))

        month = today.strftime("%Y-%m")
        responses = {path: ask(path) for path in CORE}
        responses[f"/budget-overview?month={month}"] = ask(f"/budget-overview?month={month}")
        # No sign-in and no account in the demo: it opens straight onto the ledger.
        responses["/auth/status"] = {"initialized": True, "demo_enabled": False}
        responses["/auth/me"] = responses["/auth/me"] | {"username": "demo", "csrf": "demo"}
        lazy = {}
        for path, name in LAZY.items():
            reply = client.get("/api" + path)
            if reply.status_code == 200:
                save(name, reply.json())
                lazy[path] = name
            elif reply.status_code != 404:
                raise SystemExit(f"GET {path} answered {reply.status_code}")

        first = date.fromisoformat(responses["/dashboard"]["first_entry_date"])
        months = month_keys(first, today)
        years = {}
        for key in months:
            save(f"reports/{key}", ask(f"/reports?month={key}&months=1&denomination=USD"))
            answer = ask(
                f"/spending-history?start={max(date.fromisoformat(key + '-01'), first)}&end={month_end(key, today)}&interval=month"
            )
            if answer["transactions_truncated"]:
                raise SystemExit(f"{key} has more than 500 expenses; the demo cannot add its months up exactly")
            years.setdefault(key[:4], {})[key] = answer
        # One file a year: a five-year chart asks for six files, not sixty.
        for year, answers in years.items():
            save(f"spending/{year}", answers)

        recent_from = date.fromisoformat(months[max(len(months) - 3, 0)] + "-01")
        everything = ask("/transactions")
        save("transactions", everything)
        save("transactions-recent", [row for row in everything if row["date"] >= str(recent_from)])
        save("transfers", ask("/transactions?kind=transfer"))
        for account in responses["/accounts"]:
            save(f"activity/{account['id']}", ask(f"/accounts/{account['id']}/activity"))

        # Retirement is worked out by the server, so the demo keeps its answers to the changes a visitor
        # is likely to try. Each is named by what differs from the saved choices (see demo/retirement.ts).
        (data / "retirement").mkdir()
        shown = ask("/planning/retirement")
        responses["/planning/retirement"] = shown
        base, retirement = shown["settings"], {}

        def keep(changes, trying=()):
            answer = ask(
                "/planning/retirement/draft", "POST", json={"settings": base | changes, "trying": sorted(trying)}
            )
            # What no change here moves is left out and filled in from the opening answer.
            parts = {name: value for name, value in answer.items() if value != shown[name] and name != "settings"}
            name = str(len(retirement))
            save(f"retirement/{name}", parts)
            retirement[json.dumps([dict(sorted(changes.items())), sorted(trying)], separators=(",", ":"))] = name

        levers = [lever["id"] for lever in shown["answer"]["levers"]]
        for rate in range(0, 41):
            if str(rate) != base["growth_pct"]:
                keep({"growth_pct": str(rate)})
        keep({"growth_pct": None})
        for picked in range(1, 2 ** len(levers)):
            keep({}, [lever for i, lever in enumerate(levers) if picked >> i & 1])
        for lever in levers:
            keep({"freed_to_bitcoin": False}, [lever])
        keep({"freed_to_bitcoin": False})
        keep({"use_record": False})
        keep({"cost_rise_pct": shown["money_supply_pct"]})
        keep({"cost_rise_pct": shown["money_supply_pct"], "use_record": False})
        for row in shown["ledger"]["years"][:-1]:
            keep({"measure_from": row["year"]})
        for tax in range(0, 31, 5):
            if str(tax) != base["tax_pct"]:
                keep({"tax_pct": str(tax)})
        for row in shown["ledger"]["one_offs"]:
            keep({"left_out_entries": [row["id"]]})

        # The server's own answers for longer spans. The front-end tests add the saved months up
        # and must arrive at exactly these, or the demo build fails.
        year_ago = months[max(len(months) - 13, 0)]
        dining = next(item["id"] for item in responses["/categories"] if item["name"] == "Dining")
        spans = [
            (f"/spending-history?start={first}&end={today}&interval=year", None),
            (f"/spending-history?start={first}&end={today}&interval=month", None),
            (f"/spending-history?start={first}&end={today}&interval=month&summary=true", None),
            (f"/spending-history?start={year_ago}-01&end={month_end(months[-2], today)}&interval=month", None),
            (
                f"/spending-history?start={months[-25] if len(months) > 25 else months[0]}-01&end={today}"
                f"&interval=year&category_id={dining}",
                "Dining",
            ),
        ]
        # Kept beside the demo's files, not among them: the tests read it and the website never does.
        (args.out.parent / "demo-checks.json").write_text(
            json.dumps([{"path": path, "category": category, "answer": ask(path)} for path, category in spans])
        )

        save(
            "core",
            {
                "captured_at": captured.isoformat(timespec="seconds"),
                "today": str(today),
                "first_month": months[0],
                "recent_from": str(recent_from),
                "quote": quote,
                "prices": {
                    "source": prices.source,
                    "method": prices.method,
                    "through": str(prices.end),
                    "retrieved_at": prices.retrieved_at,
                },
                "lazy": lazy,
                "retirement": retirement,
                "responses": responses,
            },
        )

    for name in ("mark.svg", "icon-192.png", "icon-512.png"):
        shutil.copyfile(PUBLIC / name, args.out / name)
    (args.out / "manifest.webmanifest").write_text(
        json.dumps(
            {
                "name": "Appalachian Bitcoin: fictional demo",
                "short_name": "Demo",
                "start_url": "./",
                "scope": "./",
                "display": "browser",
                "icons": [{"src": "icon-192.png", "sizes": "192x192", "type": "image/png"}],
            },
            indent=2,
        )
    )
    size = sum(item.stat().st_size for item in data.rglob("*.json"))
    print(
        f"Saved the demo as of {today}: {loaded['entries']} entries since {loaded['from']}, "
        f"{len(months)} months, {size / 1e6:.1f} MB of answers in {data.relative_to(ROOT)}."
    )
    if responses["/dashboard"]["price"] is None:
        print("Warning: the demo has no current price. Run without --offline to take a real quote.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
