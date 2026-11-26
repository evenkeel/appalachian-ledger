# Backup and restore

## Encrypted backup (recommended)

1. In **Settings → Data ownership**, enter a passphrase.
2. Select **Download encrypted backup** and keep the `.albackup` file outside this device.
3. Store the passphrase separately. There is no recovery key or cloud recovery service.

The export includes users/password hashes, accounts, entries, postings, categories, rates, budgets, assets, valuations, import jobs, wallet names and audit history. It excludes live sessions and RPC credentials. Back up your protected deployment configuration separately.

To restore, first download a backup of the current ledger. Open **Restore an encrypted backup**, choose the file, enter its passphrase and check the replace acknowledgement. The server validates authentication, schema, foreign keys and balanced journals before replacing data. Sign in with the credentials stored in the restored backup. Wrong passphrases, damaged ciphertext and incompatible schema are rejected without replacing the current ledger.

To restore to a fresh installation, create a temporary local owner first. Restore then replaces that temporary owner with the backed-up owner. Migrate older backups using the matching application version before importing into a newer schema.

The in-app size limit is 256 MB, which is several hundred years of an ordinary ledger. Backups are verified during restore; keep more than one generation and periodically test a restore into a separate installation.

## Offline filesystem backup

For larger databases, stop writes before copying. In a local development checkout:

```sh
# Stop the backend process first.
mkdir -p backup
cp data/ledger.db backup/ledger.db
```

For Compose, copy `/data/ledger.db` from the stopped backend container:

```sh
docker compose stop backend
mkdir -p backup
docker compose cp backend:/data/ledger.db backup/ledger.db
docker compose start backend
```

This raw file is **not encrypted**. Store it on an encrypted disk or encrypt it with your own established backup system. Do not add database files, exports or secrets to Git. If you change SQLite journal mode to WAL in a future version, use the SQLite backup API or copy the complete stopped database state, including its WAL files.

For raw recovery, preserve the current volume, stop the backend, restore the file with UID/GID 10001 ownership, and start the matching application version. Raw recovery is an administrative operation and bypasses the in-app encrypted-restore verification; run `PRAGMA integrity_check` and `PRAGMA foreign_key_check` before accepting the recovered file.

## Upgrading to separate USD and bitcoin budgets

Stop the API and take an encrypted backup using the old version or a consistent offline SQLite backup before upgrading. Run `alembic upgrade head` (automatic in Compose). Revision `0003_currency_budgets` retains existing allowances as combined bitcoin-equivalent budgets; no balances, postings, rates, or original amounts are converted. New currency-specific plans can coexist with them.

This schema change intentionally cannot downgrade: a dollar plan cannot be safely collapsed into a bitcoin amount without a chosen rate and changed meaning. Keep the pre-upgrade backup. An older encrypted backup must first be restored with its matching application version, then migrated, then exported again for restore into the new version. Plain database snapshots are unencrypted and must remain local/protected.
