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

How often backups are taken, how long they are kept, and where they are stored (off the database
host, and encrypted) are decided with the database host — nothing here chooses them.

## Last run (2026-09-29, local)

Postgres 16.10 (portable, on 127.0.0.1): all 27 migrations applied as written — **the first time
they ran on real Postgres rather than the test harness** — plus the synthetic `drill-seed.sql` (two
stores, 650 products, 1,000 audit rows). Backup: 64 tables, 257 KB, 0.24 s. Verify: `ok`, 1,726 rows
across 64 tables, restore 0.75 s, 45 tables with RLS on and forced, isolation probe clean.

Seen to fail, each with exit 1 and its reason: RLS not forced on a table; RLS off (the probe then read
650 rows of the other store); a row missing; a policy dropped (and the probe read nothing, which it
reports rather than passes); a column added; a dump altered after its manifest was written.
