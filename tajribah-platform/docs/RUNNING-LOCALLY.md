# Running Tajribah on your computer

**No Docker is needed** for any of it. Everything below has been run on this Windows machine.

Everything is one app, `tajribah-platform`: the website (tajribah.org) and the try-on studio shoppers
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
SeaweedFS (a single program, no Docker). Without it, uploads wait in "processing". With the local start scripts
(`~/tajribah-local`): `start-storage.sh`, then `start-dashboard.sh` and `start-worker.sh` (the worker reads the
dashboard script's settings; without it, a new try-on picture stays "checking the size…"). On this computer the worker also
runs what the Cloudflare Worker runs in production (`WORKER_ALL_QUEUES=1`, set by `start-worker.sh`): after "Sync now" on a feed,
your published buttons are refreshed by it. The dashboard's pages, when opened at
127.0.0.1 or localhost, may upload to storage on this computer; publishing to a shop still needs https
storage on the real host — locally, publishing works for this computer only (T75): the product's own
page at `http://127.0.0.1:8799/p/…` shows it. Published settings are kept in the local storage, so they
survive a restart.

**Testing the QR with your phone, and the one-domain layout:** `docs/DOMAINS.md` (start both
scripts with `lan`; the phone opens the computer's Wi-Fi address on the same network).

## D. The button on your store's real pages (Salla, Google Tag Manager)

On a real store the button arrives through one tag in Google Tag Manager (the dashboard's «التركيب في متجرك»).
Before touching Tag Manager, you can see exactly what shoppers will see on this computer: a small **test shop**
serves your store's real product pages, read live from its public address, with the tag added the way Tag
Manager adds it. Nothing is changed on your store.

**Before you start** — with section C running:

1. Storage, the dashboard and the worker are running, each in its own window (`~/tajribah-local`):
   `bash start-storage.sh`, `bash start-dashboard.sh`, `bash start-worker.sh`.
2. Your products came from your feed, and know their pages: on **Store connections** press «مزامنة الآن» once.
   (Each product's page in Salla comes from its `link` in the feed; the worker then refreshes what is published.)
3. At least one product is published: its try-on settings → «انشر في المتجر».
4. The widget is built (again after pulling new code):

   ```sh
   cd tajribah-platform
   node widget/build.mjs
   ```

**Start the test shop** in a fourth window, from `tajribah-platform`, and leave it open while you test:

```sh
node scripts/dev/test-shop.mjs --store <your store key> --from https://<your store's address>
```

- **Your store key** is in the tag on «التركيب في متجرك» (`data-tajribah-store="…"`). For the store on this
  computer it is `store-ymc7f8`, so for Failet:
  `node scripts/dev/test-shop.mjs --store store-ymc7f8 --from https://failet.sa`
- It prints `test shop: http://127.0.0.1:8812/…` when it is ready.

**Open a product page:** `http://127.0.0.1:8812/ar/x/p<the product's number on Salla>`. The number is the end of
the product's address on your store — `…/p1713032054` → `http://127.0.0.1:8812/ar/x/p1713032054` (the words
before it do not matter). The page is your store's own: its header, gallery, instalment boxes, add-to-cart bar and
related products, from the store's own scripts. A published product shows «جرّبها…» centred under its picture;
tapping it opens the try-on in a window over the same page (tap outside it, or its ×, to close). A product that is
not published shows nothing, and so does the home page — as on the real store.

- `--spot options` puts the button under the product's options, above «أضف للسلة», instead (the tag's other choice).
- `--still` serves the page without any of the store's scripts, if something on it misbehaves here.

**Stop it** with Ctrl+C in its window (or close the window).

**If something is off:**

| What you see | Why, and what to do |
|---|---|
| `Port 8812 is already in use` | A test shop is already running (another window, or one started earlier). Use that one, stop it first, or add `--port 8813` and open `http://127.0.0.1:8813/…`. |
| The address does not open at all | The test shop is not running: start it (above) and keep its window open. |
| The page opens, but no button | The product is not published; or its page is not known yet («مزامنة الآن», then wait for the worker); or the dashboard is not running at `http://127.0.0.1:8799`. |
| `Build the widget first` | Run `node widget/build.mjs` once, then start the test shop again. |
| `… did not answer` | Your store's page could not be read: check the address after `--from` (https, no path), and your internet. |

**Nothing is counted from here.** The page carries a Content-Security-Policy: the store's scripts may load only
from Salla's file hosts (and the instalment and Apple Pay boxes Salla shows), and may call only Salla's storefront
API (reads: the product, offers, comments, ratings). Your Tag Manager, Google Analytics, Salla's own visit counting,
pixels, heatmaps and Cloudflare's beacon are blocked before they start. «منتجات مشابهة» is filled with the product's own category
(Salla's recommendations answer only your store's own address, which this computer does not pretend to be), and
Apple Pay cannot show here (it needs https).

Only for this computer: the button's settings come from your local dashboard. On the real store, nothing here is used: the
tag in your Tag Manager container loads Tajribah's widget from `cdn.tajribah.org` once it is live (GO-LIVE §1).

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
- **Background work without `start-worker.sh`** (a product feed's scheduled sync, model and picture checks, refreshing published buttons) — nothing else consumes the queue on this machine; "Sync now" and a file upload import at once.
- **Checking the install on a page of this computer** — the checker opens public https pages only; it checks your real store's pages (and their Google Tag Manager containers) from here.
