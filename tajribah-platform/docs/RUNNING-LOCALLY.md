# Running Tajribah on your computer

**No Docker is needed** for any of it. Everything below has been run on this Windows machine.

Everything is one app, `tajribah-platform`: the website (tajribah.sa) and the try-on studio shoppers
open (`site/`, pages at `/`), the merchant dashboard (`/dashboard`), the staff console (`/admin`), the
API and the shop widget. (`tajribah-try-on` is the website's old copy, kept only until it is deleted.)

## What to install, once

1. **Node.js 22** (the LTS, 22.13 or newer) from nodejs.org. Your machine has Node 20, which is too
   old for these apps — installing 22 replaces it.
2. **pnpm**, which comes with Node: open a terminal and run `corepack enable`.
3. **PostgreSQL 16** — only if you want to sign in to the dashboard with a real account (step C
   below). The Windows installer from postgresql.org (EnterpriseDB) is the simplest; no Docker.
4. Git Bash (comes with Git for Windows) for the commands below.

Then, in `tajribah-platform`:

```sh
pnpm install --no-lockfile   # the platform keeps no lockfile
```

## A. The website and the try-on studio

They are served by the same app as the dashboard: run step C (or, without a database, step C's build
and start with any values — the website's pages need no database) and open http://127.0.0.1:8799/ —
the home page, `/demo` with the live studio (watch, glasses, ring, necklace, bag) and "on me" with your
own photo, `/pricing`, and the rest. The website's static preview, for screenshots:
`node site/preview/build.mjs` → `dist-site-preview/`.

## B. The dashboard, with demo data (no database)

The quickest way to look around every screen — a demo store (Failet, as an example) with sample data,
and nothing to set up:

```sh
cd tajribah-platform
node preview/build.mjs --modules node_modules     # builds into dist-preview/
npx serve dist-preview                             # then open the address it prints
```

Serve the folder over http rather than opening the file: opened as a file, the page stays blank.

## C. The dashboard, for real (with a database)

This is the real thing: sign up, sign in, your own store, real data.

**1. The database.** With PostgreSQL 16 installed (user `postgres`):

```sh
psql -U postgres -c "create database tajribah_dev"
node scripts/db/migrate.mjs --db postgresql://postgres@127.0.0.1:5432/tajribah_dev
psql -U postgres -d tajribah_dev -c "CREATE ROLE tajribah_app_login LOGIN PASSWORD 'app-dev' IN ROLE tajribah_app; CREATE ROLE tajribah_admin_login LOGIN BYPASSRLS PASSWORD 'admin-dev' IN ROLE tajribah_admin;"
```

(Use your own passwords. `migrate.mjs` can be run again any time; it applies only what is new.)

**2. Two secrets.** Make two random values, once, and keep them:

```sh
openssl rand -base64 48      # → AUTH_SECRET
openssl rand -base64 48      # → ENCRYPTION_KEY
```

**3. Build and run:**

```sh
pnpm build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev \
  --config dist/server/wrangler.json --local --ip 127.0.0.1 --port 8799 \
  --var APP_URL:http://127.0.0.1:8799 --var AUTH_SECRET:<first value> --var ENCRYPTION_KEY:<second value> \
  --var DATABASE_APP_URL:postgresql://tajribah_app_login:app-dev@127.0.0.1:5432/tajribah_dev \
  --var DATABASE_ADMIN_URL:postgresql://tajribah_admin_login:admin-dev@127.0.0.1:5432/tajribah_dev
```

Open http://127.0.0.1:8799 and sign up. Emails (verification, password reset) are printed in this
terminal instead of being sent, since no mail provider is set up yet.

**Optional — 3D models and try-on pictures.** Optimising an uploaded 3D model and checking a try-on
picture run in a separate Node process (`node scripts/worker-node.mjs`) and need S3-style storage. For
this on your computer, `DATABASE.md` → "Model and picture work on this machine" shows how with
SeaweedFS (a single program, no Docker). Without it, uploads wait in "processing". The dashboard's pages, when opened at
127.0.0.1 or localhost, may upload to storage on this computer; publishing to a shop still needs https
storage on the real host — locally, publishing works for this computer only (T75): the product's own
page at `http://127.0.0.1:8799/p/…` shows it. Publish again after restarting the server (published
settings are kept in memory here).

## The checks

```sh
cd tajribah-platform
node scripts/test.mjs --modules node_modules       # every test (about 900); a name filters: … glasses
pnpm lint
pnpm typecheck
```

These are what GitHub runs on every push.

## What does not work on your computer, and why

- **Store connections (Salla, Zid, Shopify)** — each needs its app registered with the platform first.
- **Card payments, phone codes by SMS, generating 3D models from photos** — each needs its provider's account.
- **Real emails** — printed to the terminal until a mail provider is set.
- **Background work** (a product feed's sync, model and picture checks) — no queue consumer runs on this machine, so a linked feed waits in "queued"; a file upload imports at once.
