# The database: setting it up, updating it, and running the app on it

PostgreSQL 16 (the plan's choice), reached from the Cloudflare Worker through **Hyperdrive** and the
`pg` driver (DECISIONS T60). The host is still yours to choose (the Hetzner question); nothing here
depends on which.

## Once, on the database server

Run as the database's owner (the login that will own the tables):

```sql
CREATE DATABASE tajribah;
```

```sh
# Every migration, in order, each once (a ledger records them; see "Updating" below).
node scripts/db/migrate.mjs --db "postgresql://owner@host:5432/tajribah"
```

The migrations create two roles without logins: `tajribah_app` (row-level security applies) and
`tajribah_admin` (bypasses it, for sign-in and the job queue). Give each a login of its own:

```sql
CREATE ROLE tajribah_app_login   LOGIN PASSWORD '…' IN ROLE tajribah_app;
CREATE ROLE tajribah_admin_login LOGIN BYPASSRLS PASSWORD '…' IN ROLE tajribah_admin;
```

`BYPASSRLS` is on the admin login itself because it is not inherited through membership. Two logins,
not one login switching roles: Hyperdrive pools by transaction, so a `SET ROLE` would not survive.

## The dashboard Worker

Create two Hyperdrive configurations, one per login, and bind them as **`HYPERDRIVE_APP`** and
**`HYPERDRIVE_ADMIN`**. (Without Hyperdrive, set **`DATABASE_APP_URL`** and **`DATABASE_ADMIN_URL`** as
secrets instead.) Production will not start without one or the other. **Check:** `/api/health/ready`
answers 200 with `"database": "ok"`.

Each request, and each background pass, opens one connection per login on its first query and ends
them when it is done (`db/client.ts`, `withDbConnection`): a Worker may not reuse a connection
between requests, and Hyperdrive keeps the real connections warm.

## Updating

Deploy the new code's migrations **before** the new code: every migration is expand-only (the
migration-safety test holds them to it), so the version still running keeps working meanwhile.

```sh
node scripts/db/migrate.mjs --db … --status   # what is applied, what is pending
node scripts/db/migrate.mjs --db …            # apply what is pending, in order
```

A migration already applied whose file has changed stops the run: migrations are history. A file that
fails part way stops the run and is not recorded — read the error, finish or undo by hand (each file's
`-- ROLLBACK:` block), then run again.

## The whole app on a Postgres on this machine (tried 2026-09-30)

With the portable Postgres from `docs/DR.md` on port 55432:

```sh
psql -h 127.0.0.1 -p 55432 -U postgres -c "create database tajribah_dev"
node scripts/db/migrate.mjs --db postgresql://postgres@127.0.0.1:55432/tajribah_dev
psql … -d tajribah_dev -c "CREATE ROLE tajribah_app_login LOGIN PASSWORD 'app-dev' IN ROLE tajribah_app; CREATE ROLE tajribah_admin_login LOGIN BYPASSRLS PASSWORD 'admin-dev' IN ROLE tajribah_admin;"
node scripts/run-framework.mjs build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local \
  --ip 127.0.0.1 --port 8799 --var APP_URL:http://127.0.0.1:8799 --var AUTH_SECRET:… --var ENCRYPTION_KEY:… \
  --var DATABASE_APP_URL:postgresql://tajribah_app_login:app-dev@127.0.0.1:55432/tajribah_dev \
  --var DATABASE_ADMIN_URL:postgresql://tajribah_admin_login:admin-dev@127.0.0.1:55432/tajribah_dev
```

Seen that day: all 29 migrations applied by the runner (a second run: "up to date"; an edited applied
file refused); readiness 200 with the database ok; sign-up created a store; **signing in through the
dashboard's own sign-in page in a real browser** opened the dashboard — the new store, in Arabic, on its
Growth trial; saving store settings went through row-level security on the app login and read back; a
second store saw only its own settings and team; no errors in the log.
