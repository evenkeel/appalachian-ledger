import csv
import hashlib
import io
import json
from collections import Counter
from pydantic import ValidationError
from sqlalchemy import select
from .accounting import account, create_transaction, audit
from .models import Category, ImportJob, JournalEntry
from .money import to_minor
from .schemas import TransactionInput

HEADERS = {"date", "kind", "amount", "description", "category"}


def import_csv(db, account_id, content, filename="import.csv"):
    acc = account(db, account_id)
    try:
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
    except UnicodeError:
        raise ValueError("CSV must be UTF-8") from None
    if not reader.fieldnames or not HEADERS.issubset(reader.fieldnames):
        raise ValueError("CSV requires date,kind,amount,description,category; optional external_id,notes")
    categories = {(c.name.casefold(), c.kind): c.id for c in db.scalars(select(Category))}
    imported, duplicates = 0, 0
    occurrences = Counter()
    reversed_ids = select(JournalEntry.reverses_id).where(JournalEntry.reverses_id.is_not(None))
    replaced_ids = select(JournalEntry.replaces_id).where(JournalEntry.replaces_id.is_not(None))
    rows = enumerate(reader, 2)
    while True:
        try:
            index, row = next(rows)
        except StopIteration:
            break
        except csv.Error as exc:
            raise ValueError(f"CSV could not be read: {exc}") from None
        if index > 10001:
            raise ValueError("Import is limited to 10,000 rows")
        try:
            # Short rows yield None and extra cells arrive as a list; neither is a usable value.
            def cell(name):
                value = row.get(name)
                return value.strip() if isinstance(value, str) else ""

            if None in row:
                raise ValueError("Row has more values than the header")
            kind = cell("kind").lower()
            if kind not in ("income", "expense"):
                raise ValueError("kind must be income or expense; use the transfer form for transfers")
            category = categories.get((cell("category").casefold(), kind))
            if category is None:
                raise ValueError("Unknown category or mismatched category type")
            data = TransactionInput(
                date=cell("date"),
                kind=kind,
                amount=cell("amount"),
                account_id=account_id,
                description=cell("description"),
                category_id=category,
                notes=cell("notes"),
            )
            normalized = [
                acc.id,
                str(data.date),
                data.kind,
                to_minor(data.amount, acc.currency),
                data.description,
                category,
                data.notes,
            ]
            external = cell("external_id")
            if external:
                material = json.dumps([acc.id, "external", external])
            else:
                material = json.dumps(normalized)
                occurrences[material] += 1
                material += ":" + str(occurrences[material])
            # Posted entries are immutable, so a row whose earlier import was deleted
            # is imported again under the next free key instead of being skipped forever.
            attempt = 0
            while True:
                suffix = f":reimport:{attempt}" if attempt else ""
                key = "csv:" + hashlib.sha256((material + suffix).encode()).hexdigest()
                previous = db.scalar(select(JournalEntry.id).where(JournalEntry.import_key == key))
                if previous is None:
                    create_transaction(db, data, import_key=key)
                    imported += 1
                    break
                deleted = db.scalar(
                    select(JournalEntry.id).where(
                        JournalEntry.id == previous,
                        JournalEntry.id.in_(reversed_ids),
                        JournalEntry.id.not_in(replaced_ids),
                    )
                )
                if deleted is None:
                    duplicates += 1
                    break
                attempt += 1
        except (ValueError, KeyError, ValidationError) as exc:
            raise ValueError(f"CSV row {index}: {exc}") from None
    job = ImportJob(filename=filename[:200], imported=imported, duplicates=duplicates)
    db.add(job)
    audit(db, "csv.import", "accounts/" + str(account_id), {"imported": imported, "duplicates": duplicates})
    return {"imported": imported, "duplicates": duplicates}
