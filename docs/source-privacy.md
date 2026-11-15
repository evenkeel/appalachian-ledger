# Source publication and private data

The published repository contains application source, migrations, documentation,
branding assets, and fictional test/demo fixtures. It starts with a fresh source
snapshot so prior local commits and their machine-specific author metadata are
not included.

Personal ledgers, database copies, encrypted backups, exports, environment files,
credentials, logs, local handoff notes, and documentation screenshots are excluded
from Git and Docker build contexts. The original local files are retained on the
computer where they were created. The sample transaction CSV is explicitly
fictional; it is the only CSV allowed by the default ignore rules.

Clone the repository on another machine and follow the README to install and run
it. A clone starts without a personal ledger or login. Transfer an encrypted
backup separately if you need your records; never commit that backup or its
passphrase. See [backup and restore](backup-and-restore.md).

Before each publication, inspect `git status` and the staged diff for private
content. Ignore rules do not protect secrets pasted into source files, files
already tracked by Git, or files deliberately added with `git add -f`. Run a
secret scanner and review new assets before pushing. Use a GitHub noreply email
for commit authorship if you do not want to publish a personal email address.
