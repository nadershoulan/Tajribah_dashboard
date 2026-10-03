# Where Tajribah runs in production

## The short answer

| Piece | Runs on | Why there |
|---|---|---|
| Website + try-on (`tajribah.sa`) | **Cloudflare Workers** | Served from Cloudflare's network close to every shopper; nothing to keep running |
| Dashboard + API (`app.tajribah.sa`) | **Cloudflare Workers** | The same |
| Shop widget, 3D files, pictures (`cdn.tajribah.com`) | **Cloudflare R2** | Storage with no charge for downloads — shoppers download a lot |
| What each shop button shows (`cfg.tajribah.com`) | **Cloudflare Workers + KV** | Shops read it on every product page; it must never wait on the database |
| The database (PostgreSQL 16) | **A Hetzner Cloud server** | Your decision (DECISIONS T11) |
| Image and 3D work (`scripts/worker-node.mjs`) | **The same Hetzner server** | It needs a program (sharp) that cannot run on Cloudflare |

So you need **a Cloudflare account** (free to start; the paid Workers plan is about $5 a month) and
**one small Hetzner Cloud server** (a CX22-class machine, around €4–6 a month, is enough to start).

## Will Hetzner shared hosting (Webhosting) with SSH work?

**No — use a Hetzner Cloud server instead.** Hetzner's shared hosting does offer PostgreSQL, SSH and
Node.js on its larger plans, but it does not fit what Tajribah needs:

1. **The database needs two special logins.** The app uses two database roles — one that row-level
   security applies to, one that is allowed past it (`BYPASSRLS`) for sign-in and background work.
   Creating roles like that needs administrator rights on the database server. Shared hosting gives
   you a database, not the server, so this step cannot be done — and without it the app will not start.
   This is what keeps one store from ever seeing another's data, so it cannot be skipped.
2. **The database must be reachable from Cloudflare.** The dashboard runs on Cloudflare and talks to
   the database through Cloudflare Hyperdrive, over the internet. Shared hosting databases usually
   accept connections only from the hosting account itself.
3. **The image/3D worker runs all the time**, without a web page. Hetzner's shared Node.js hosting is
   made for a website that answers visitors; a background program that runs forever is not what it is
   built for, and memory is limited.
4. **Migrations, backups and the restore drill** need the standard PostgreSQL tools (`pg_dump`,
   `pg_restore`, `psql`) with full access — `DR.md`.

A **Hetzner Cloud server** (a virtual machine you control) solves all four: you install PostgreSQL 16
yourself, create the two logins, open the database only to Cloudflare, and run the worker as a service.
It costs about the same as the larger shared plans.

## What the Hetzner server holds

- PostgreSQL 16, with the `tajribah` database and its two logins (`DATABASE.md`)
- The image/3D worker under systemd (`GO-LIVE.md` §3, "A Node worker")
- The nightly backup (`DR.md`), copied off the server and encrypted

Everything else stays on Cloudflare. `GO-LIVE.md` is the step-by-step list for setting both up.

## Google sign-in for GA4 (optional)

GA4 measurement ids can always be pasted (staff console → Website; a store's Settings → Google
Analytics). To also offer "Pick it by signing in with Google", make one OAuth client (T69):

1. console.cloud.google.com → a project for Tajribah → **APIs & Services → Library** → enable
   **Google Analytics Admin API**.
2. **OAuth consent screen** → External → app name Tajribah, support email, the domain; add the scope
   `.../auth/analytics.readonly`. (Read-only Analytics is a "sensitive" scope: until Google verifies
   the app, only test users you list can sign in — enough for you and the first stores.)
3. **Credentials → Create OAuth client ID → Web application**; authorised redirect URI:
   `https://app.tajribah.sa/api/google/callback` (and `http://localhost:8799/api/google/callback`
   for this machine).
4. Put the two values on the dashboard Worker: `GOOGLE_CLIENT_ID` (a variable) and
   `GOOGLE_CLIENT_SECRET` (`wrangler secret put`). The button appears on both screens.

Nothing of Google's is stored: the sign-in is used once to list the web streams, then dropped.
