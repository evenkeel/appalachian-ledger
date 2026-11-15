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
    for index, row in enumerate(reader, 2):
        if index > 10001:
            raise ValueError("Import is limited to 10,000 rows")
        try:
            if row["kind"] not in ("income", "expense"):
                raise ValueError("CSV supports income and expense; use the transfer form for transfers")
            category = categories.get((row["category"].strip().casefold(), row["kind"]))
            if category is None:
                raise ValueError("Unknown category or mismatched category type")
            data = TransactionInput(
                date=row["date"],
                kind=row["kind"],
                amount=row["amount"].strip(),
                account_id=account_id,
                description=row["description"].strip(),
                category_id=category,
                notes=row.get("notes", "") or "",
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
            external = (row.get("external_id") or "").strip()
            if external:
                material = json.dumps([acc.id, "external", external])
            else:
                material = json.dumps(normalized)
                occurrences[material] += 1
                material += ":" + str(occurrences[material])
            key = "csv:" + hashlib.sha256(material.encode()).hexdigest()
            if db.scalar(select(JournalEntry.id).where(JournalEntry.import_key == key)):
                duplicates += 1
                continue
            create_transaction(db, data, import_key=key)
            imported += 1
        except (ValueError, KeyError, ValidationError) as exc:
            raise ValueError(f"CSV row {index}: {exc}") from None
    job = ImportJob(filename=filename[:200], imported=imported, duplicates=duplicates)
    db.add(job)
    audit(db, "csv.import", "accounts/" + str(account_id), {"imported": imported, "duplicates": duplicates})
    return {"imported": imported, "duplicates": duplicates}
