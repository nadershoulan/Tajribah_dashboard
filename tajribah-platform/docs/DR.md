# Disaster recovery — backups and the restore drill (P7)

What we do when the database is lost or damaged, and how we know a backup would bring it back. The
plan's P7 gate asks for a **restore drill**: a backup restored, checked, and timed, by someone who
did not take it on trust.

## The toolkit

`scripts/dr/drill.mjs` — standard Postgres tools only (`pg_dump`, `pg_restore`, `psql`), so it works
on whichever host is chosen (DECISIONS T9). `PG_BIN` points at the binaries if they are not on PATH.

| Command | Does |
|---|---|
| `backup --db <url> --out <dir>` | A custom-format dump, and beside it a manifest: its SHA-256, a fingerprint of every column and type, the number of row-level security policies, and per table its rows and whether RLS is on and forced |
| `verify --dump <file> --server <url>` | Restores into a new scratch database on that server and checks it against the manifest (`scripts/dr/compare.mjs`); probes isolation as the application role (one store reads its own products and none of another's); reports the restore time; drops the scratch database; exit 1 on any problem |

`verify` refuses a dump whose checksum is not the manifest's. It creates the two roles if the server
lacks them (roles live in the cluster, not in a dump), so a brand-new server can take a restore.

## The drill

1. Take a backup of production (or a production-sized copy) with `backup`.
2. On a separate server, run `verify`. It must print `"ok": true`.
3. Write down `restoreSeconds` — that is the time to recover the data, before the application is
   pointed at it.
4. Keep the report with the date. At a gate, the drill is run again, not remembered.

**Decided 2026-10-07 (T108)** — the database's own backups, in place of Hetzner's disk snapshots:
- **Every night at 03:15 Riyadh time** (`deploy/server/tajribah-backup.timer`), `scripts/dr/nightly.mjs run`
  takes a checked dump (`backup`). **Every Sunday** it also restores the dump into a scratch database and
  checks it (`verify`).
- **Encrypted on the server to a public key** (`scripts/dr/seal.mjs`: X25519 + AES-256-GCM, Node's own crypto).
  The server holds only `deploy/server/backup-public.pem`, so it can encrypt but never read an old backup.
  The private key is `~/.tajribah/backup-private.pem` on Nader's computer and **must also be in his
  password manager**; without it no backup can be opened.
- **Stored off the server**, in the private R2 bucket **`tajribah-backups`**, through a token that reaches only
  that bucket (`tajribah-backups-writer`).
- **Kept** every night for 14 days, then the newest of each week for 8 weeks; older copies are deleted by the job.
- **Logged in as `tajribah_backup`**, a read-only login (`pg_read_all_data`, `BYPASSRLS`). The admin login
  cannot dump the monthly partitions.
- **Restoring:** `node scripts/dr/nightly.mjs list`, then `fetch --key <key> --out <dir>`, then
  `drill.mjs verify` (to check it) or `pg_restore` (to use it).

First run (2026-10-07, against the local database): a 2.9 MB dump, restored and checked in 1.8 s, sealed and
uploaded, 19 s in all. Then downloaded, opened with the private key and restored again: `ok`, 75 tables,
27,003 rows, 1.7 s. That test copy was then deleted from the bucket.

## Last run (2026-09-29, local)

Postgres 16.10 (portable, on 127.0.0.1): all 27 migrations applied as written — **the first time
they ran on real Postgres rather than the test harness** — plus the synthetic `drill-seed.sql` (two
stores, 650 products, 1,000 audit rows). Backup: 64 tables, 257 KB, 0.24 s. Verify: `ok`, 1,726 rows
across 64 tables, restore 0.75 s, 45 tables with RLS on and forced, isolation probe clean.

Seen to fail, each with exit 1 and its reason: RLS not forced on a table; RLS off (the probe then read
650 rows of the other store); a row missing; a policy dropped (and the probe read nothing, which it
reports rather than passes); a column added; a dump altered after its manifest was written.
