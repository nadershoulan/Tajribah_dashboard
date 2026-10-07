# Going live on Cloudflare — the checklist

Everything the code already expects once the Cloudflare account and the domains exist, in the
order it can be done. Each line names where the expectation lives in the code and how to check it
worked. Hosts and names are the ones the code uses (T105): **one domain, tajribah.org** — the website,
the try-on and the dashboard (`/dashboard`) — with `cdn.`, `cfg.`, `ev.` and `domains.` (docs/DOMAINS.md).

**Where things stand (2026-10-07).** `tajribah.org` was bought **through Cloudflare's registrar**, so it is
already a zone in the Cloudflare account: no nameservers to change, and its DNS is edited in Cloudflare.
The **Hetzner server is a later step**. It holds the database and the image/3D worker (docs/HOSTING.md),
so the parts below that need them wait for it:

| Can be done now (Cloudflare only) | Waits for the Hetzner server |
|---|---|
| §1 the R2 buckets, `cdn.tajribah.org`, uploading the shop script and its files | §3 the dashboard Worker (it needs the database), Hyperdrive, the Node worker |
| §2 the KV namespaces (`CONFIGS`, `RATE_LIMITS`) and the config host on `cfg.tajribah.org` (it answers "none" until products are published) | §4 the website on `tajribah.org` (the same Worker as the dashboard) |
| email: the mail provider's DNS records on the `tajribah.org` zone | §5 `ev.tajribah.org` (a route to that Worker) |

**Created in Cloudflare (2026-10-07, account `bd0491e496ffa057396c434b050520a1`):**
- R2 bucket **`tajribah-files`** (public through **`cdn.tajribah.org`**, Active) with its CORS policy: `PUT` + `content-type` from `https://tajribah.org`; `GET`/`HEAD` from any origin.
- R2 bucket **`tajribah-pair`** — private (public access disabled, no domain); the Worker's `PAIR_BUCKET` (`vite.config.ts`).
- KV **`tajribah-configs`** `3f494fe78a65471fb90aa426c068cbbf` → `CONFIGS` (already in `wrangler.config-host.jsonc`).
- KV **`tajribah-rate-limits`** `64ef69a8da974ada85bfed2f4a46bb8a` → `RATE_LIMITS`.
- **Live since 2026-10-07:** the shop script and its two files on the bucket — `https://cdn.tajribah.org/w/v1/widget.js`, `vendor/model-viewer-4.0.0.min.js`, `vendor/meshopt_decoder-1.2.0.js` (`node scripts/deploy/upload-cdn.mjs`, which reads each back from the cdn); and the **config host Worker `tajribah-config-host` on `cfg.tajribah.org`** (custom domain) — an unknown product answers 404 with `access-control-allow-origin: *` and `cache-control: public, max-age=60`; a config written to `CONFIGS` answered 200 through it (a test key, deleted after).
- R2 API token **`tajribah-files-uploads`** (Object Read & Write, `tajribah-files` only, account token): its four values (`R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) are in **`.env.production.local`** in this folder — ignored by git, never committed; they go into the Worker's secrets on deploy day.

> **LIVE since 2026-10-08** (T113): `node scripts/deploy/deploy-dashboard.mjs` deploys the dashboard and website; the checks in §3–§5 passed from outside. Before each deploy, stop the local dashboard (it locks `dist/`). Search engines: robots.txt, sitemap, manifest and structured data are live (T114); Google Search Console verification is waiting on its file name or TXT code.

## Who does what next (updated 2026-10-07)

**Done:** the domain; both buckets and `cdn.tajribah.org` with the shop script on it; both KV stores; the
storage key; `wrangler login`; the config host on `cfg.tajribah.org`; the short-domain decision (T106: QR
codes stay on `tajribah.org/p/…`); the launch kit (below, §3) with `AUTH_SECRET` and `ENCRYPTION_KEY`
already generated into `.env.production.local`.

**Done later on 2026-10-07:** Browser Cache TTL set to "Respect Existing Headers" (checked: the widget now
answers `max-age=300`, the vendor files `immutable`); **Workers Paid** active ($5/month); queue **`tajribah-jobs`**
created; the **server is bought**: `tajribah-1`, 2.31.18.118, reachable with `ssh -i ~/.ssh/tajribah_hetzner root@db.tajribah.org`;
DNS **`db.tajribah.org` → 2.31.18.118, DNS only**. The server gets its own name: `tajribah.org` itself points at the
Worker (§4), never at the server, and Cloudflare's proxy carries only web traffic, not Postgres.

**Left for you**, in order — `node scripts/deploy/deploy-dashboard.mjs --check` lists whatever is still missing:

| # | What | Unblocks |
|---|---|---|
| 1 | **Cloudflare → tajribah.org → Caching → Configuration → Browser Cache TTL → "Respect Existing Headers"** (30 seconds). Today Cloudflare stamps 4 hours on every file, so a new shop script would reach shoppers up to 4 hours late; the script asks for 5 minutes | quick widget updates |
| 2 | Add the tag in Failet's **Google Tag Manager** (GTM-K4ZVD3HX, steps on «التركيب في متجرك») and press Publish — the script it loads is live now | the button on failet.sa (it shows once a product is published from a live dashboard) |
| 3 | Buy the **Hetzner server**: ready to buy in the Hetzner tab (CAX21, Falkenstein, Ubuntu 26.04, the `tajribah-server` SSH key, no host backups, $13.09 a month). Press "Create & Buy now" after adding payment | the dashboard, the website, `ev.`, the image/3D worker |
| 4 | **Email: Zoho Mail (T112), done except the app password.** Domain verified, records live, alias no-reply@tajribah.org. Generate the app password `tajribah-dashboard` (Zoho → Security → App Passwords) and put it in `.env.production.local` as `SMTP_PASSWORD` | sign-in and invoice emails |
| v2 | **Unifonic**, moved to version 2 (T110): no feature sends an SMS. Two-step sign-in uses an authenticator app. Production runs with `SMS_PROVIDER=none`, and any attempt to send fails loudly | phone codes, when a feature needs them |
| 6 | **Workers Paid** plan on Cloudflare ($5 a month) — the job queue needs it; then `npx wrangler queues create tajribah-jobs` (or tell me and I run it) | launch itself |
| later | GA4 id · Google sign-in client · Moyasar · ZATCA Fatoora · a 3D-generation provider · Better Stack uptime | analytics, billing, invoices, models from photos |
| v2 | Salla, Zid, Shopify partner accounts | store linking |

Keep these in your password manager; each is the only copy: `.env.production.local`, `~/.tajribah/backup-private.pem` (**without it no backup can be opened**), `~/.tajribah/backup.env` and `~/.ssh/tajribah_hetzner` (the server's SSH key).

**The server, set up 2026-10-07 (T109):** `deploy/server/setup.sh` (updates, SSH by key only, firewall with SSH only,
Postgres 18 on localhost, Node 22, swap, the `tajribah` user); the code at `/opt/tajribah/app` with its packages
(sharp loads on Arm); database `tajribah` with all 45 migrations applied; logins `tajribah_app_login`,
`tajribah_admin_login`, `tajribah_backup` (read-only) and `tajribah_verify` (local superuser for Sunday's
check), with passwords only in `/etc/tajribah/db.env` and `/etc/tajribah/backup.env` (root only); the nightly
backup timer enabled (next run 03:15 Riyadh) and run twice, once with the restore check. **Left on the server:** the
Cloudflare Tunnel for Hyperdrive (below), and the Node worker's service (it starts only once Unifonic is set,
since production refuses console SMS).

**Uploading code to the server** is always `bash scripts/deploy/push-server.sh` over `ssh tajribah` (deploy/server/README.md).

**Server day, in order** (steps 1 and 5 are done):
1. On the server: Postgres 16, the database and its two logins, `node scripts/db/migrate.mjs --db …` (docs/DATABASE.md).
2. **Done 2026-10-08 (T110): Hyperdrive through a Cloudflare Tunnel.** Zero Trust Free switched on. Tunnel
   `tajribah-1` runs as the `cloudflared` service on the server (4 connections) and routes `pg.tajribah.org` to
   `tcp://localhost:5432`. The Access application `pg` admits only the service token `hyperdrive-tajribah`
   (non-expiring); without it the answer is 403, checked. Hyperdrive `tajribah-app` and `tajribah-admin` were created
   through it, and their ids are in `deploy/production.jsonc`. The token is in `.env.production.local` and is never a
   Worker secret. As first planned: Postgres stays on localhost and port 5432 stays closed. `cloudflared`
   on the server publishes it to Cloudflare only, and an Access service token lets Hyperdrive in. This needs Cloudflare
   Zero Trust switched on for the account (free plan). Then the two Hyperdrive configs are created against the tunnel's
   host, and their ids are written into `deploy/production.jsonc`.
3. `node scripts/deploy/deploy-dashboard.mjs --check`, then `--dry-run`, then without a flag: build, secrets, deploy to `tajribah.org`, `www.`, `app.` and `ev.`.
4. The Node worker on the server (§3), then the checks in §3–§5.
5. **Backups (T108, docs/DR.md):** create the `tajribah_backup` login, put `deploy/server/backup.env.example` filled in
   at `/etc/tajribah/backup.env` (R2 values from `~/.tajribah/backup.env`), install the two
   `deploy/server/tajribah-backup.*` units, `systemctl enable --now tajribah-backup.timer`, then run it once:
   `systemctl start tajribah-backup` and check `journalctl -u tajribah-backup` says `backup ok`.

## 1. Storage — R2 and the CDN (`cdn.tajribah.org`)

- [x] Create the R2 bucket; bind it to the dashboard Worker as **`BUCKET`**
      (`server/core/http/bootstrap.ts`, `cloudflare-env.d.ts`).
- [x] Serve it publicly at **`cdn.tajribah.org`**; set **`CDN_BASE_URL=https://cdn.tajribah.org`** and
      **`STORAGE_PROVIDER=r2`** (`server/core/config/env.ts` refuses memory storage in production).
- [x] R2 S3 API token (Object Read & Write, this bucket only) → **`R2_ACCOUNT_ID`**, **`R2_BUCKET_NAME`**,
      **`R2_ACCESS_KEY_ID`**, **`R2_SECRET_ACCESS_KEY`** — without them the browser cannot upload
      straight to storage (presigned PUT, `server/core/storage/sigv4.ts`).
- [x] Bucket CORS: allow `PUT` with `content-type` from `https://tajribah.org` — the dashboard's
      model and cut-out uploads are browser PUTs to presigned URLs on another origin.
- [x] Upload the storefront files — `node scripts/deploy/upload-cdn.mjs` (builds, uploads, reads each back; again after
      every widget change). Paths are what the widget asks for, `widget/src/main.ts`:
  - `w/v1/widget.js` ← `node widget/build.mjs` → `widget/dist/widget.js`
  - `vendor/model-viewer-4.0.0.min.js` and `vendor/meshopt_decoder-1.2.0.js` ← `public/vendor/`
    (sources and licences in `public/vendor/README.md`; the build refuses a decoder version mismatch).
- **Check:** `https://cdn.tajribah.org/w/v1/widget.js` loads; an uploaded model's public URL loads;
  the model library shows a file's size after an upload.

- **Check (P1.13b, T65):** upload a GLB, publish it, and open its product page in the shop **on an iPhone**: the button opens Quick Look straight away (no viewer
  first) and the product stands in the room at its real size. The USDZ is `v{n}/model.usdz` beside `optimized.glb`.

## 2. Viewer configs — KV and the config host (`cfg.tajribah.org`, P1.15)

- [x] Create one KV namespace. Bind it as **`CONFIGS`** to the dashboard Worker, and put its id in
      `wrangler.config-host.jsonc` (the placeholder `REPLACE_WITH_THE_CONFIGS_NAMESPACE_ID`).
- [ ] Set **`CONFIG_STORE=kv`** on the dashboard (memory is refused in production).
- [x] Deploy the config host: `npx wrangler deploy --config wrangler.config-host.jsonc` — the custom
      domain **`cfg.tajribah.org`** is in that file, so Cloudflare makes its DNS record and certificate (done 2026-10-07).
- **Check:** publish a product in AR settings → `https://cfg.tajribah.org/v1/{store}/{product}.json`
  answers 200 with `access-control-allow-origin: *` and `cache-control: public, max-age=60`; an
  unknown product answers 404. (Seen in workerd over a local KV on 2026-09-29 — STATE.)

## 3. The dashboard (`tajribah.org/dashboard`)

**The launch kit (2026-10-07).** Everything below that is a setting is already written down:
- `deploy/production.jsonc` — the Worker's name, its four custom domains (`tajribah.org`, `www.`, `app.`, `ev.`),
  every binding (`BUCKET`, `PAIR_BUCKET`, `CONFIGS`, `RATE_LIMITS`, `JOBS`, `HYPERDRIVE_APP`, `HYPERDRIVE_ADMIN`),
  the queue consumer's limits and every plain variable. Nothing secret (a test refuses one).
- `.env.production.local` (git-ignored) — the secrets: the R2 key, `AUTH_SECRET`, `ENCRYPTION_KEY` (both generated),
  and empty slots for `RESEND_API_KEY`, `UNIFONIC_APP_SID`, `UNIFONIC_SENDER_ID`, `DATABASE_APP_URL`, `DATABASE_ADMIN_URL`.
- `scripts/deploy/deploy-dashboard.mjs` — `--check` runs the Worker's own boot check over the two together and lists
  everything missing; `--create-hyperdrive` makes the two Hyperdrive configs from the database logins; `--dry-run`
  builds and lets wrangler validate; no flag builds, sends the secrets (`wrangler secret bulk`, through stdin) and deploys.
  Validated with wrangler on 2026-10-07: every binding accepted, 1.05 MB gzipped.

- [ ] Deploy the dashboard Worker; point **`tajribah.org`** at it (§4); set **`APP_URL=https://tajribah.org`**.
- [ ] Every variable in **`.env.example`** (generated from `server/core/config/env.ts`; boot lists every
      problem at once). Secrets go in the secret store, never in a file.
- [ ] Background work (P7, T57). The Worker's entry is `server/worker/entry.ts`: pages as before, plus
      an **every-minute cron** (declared in `vite.config.ts`, deployed with the Worker) that runs the
      sweeps and drains the job queue, and a **queue consumer**. Create one queue,
      `wrangler queues create tajribah-jobs`; bind it to the dashboard Worker as a **producer named
      `JOBS`**; add the Worker as its **consumer** with `max_batch_size` 100, `max_batch_timeout` 1,
      `max_concurrency` 10 (the ceiling on parallel passes — each holds database connections; raise it
      with the database, not before), no retries needed (a message only says "look now"). Set
      **`JOBS_MODE=cf-queue`** — boot refuses it without the `JOBS` binding, and refuses `inline` in
      production. **Check:** sync a store; the sync starts within seconds, not at the next minute. In
      the logs, `queue behind` means the oldest due job waited over 2 minutes at the end of a full pass.
- [ ] **A Node worker for image and model work** (T57): `ai.postprocess` (optimising an uploaded 3D
      model) and `tryon.quality` (checking a try-on picture) use `sharp`, which cannot run on Workers;
      the Worker leaves those jobs queued. On a Node 22 host that reaches the database (the database
      server is the natural place): an R2 API token for the bucket (R2 → Manage API tokens, object read &
      write), then the dashboard's variables plus **`STORAGE_PROVIDER=s3`**, **`R2_ACCOUNT_ID`**,
      **`R2_BUCKET_NAME`**, **`R2_ACCESS_KEY_ID`**, **`R2_SECRET_ACCESS_KEY`**, and
      `node scripts/worker-node.mjs` under a process manager (systemd). It claims only those two queues
      and runs no sweeps. **Check:** upload a model; it leaves "processing" within seconds.
- [ ] Rate limits (P7): create a second KV namespace, bind it as **`RATE_LIMITS`**, and set
      **`RATE_LIMITER=kv`** — per-isolate memory counters are refused in production, since no limit
      would hold across isolates (`server/core/ratelimit/limiter.ts`).
- [ ] Uptime (P7): point the monitor (the plan names Better Stack, which also drives the status page) at
      **`https://app.tajribah.org/api/health`** (answering) and **`/api/health/ready`** (503 while the database
      cannot answer). In the log service, alert on the share of `slow request` lines per path
      (`server/core/observability/slo.ts` holds the plan's targets).
- [ ] The database (T60, `docs/DATABASE.md`): on the chosen host, create the database, run
      `node scripts/db/migrate.mjs --db …`, create the two logins; bind two Hyperdrive configurations as
      **`HYPERDRIVE_APP`** and **`HYPERDRIVE_ADMIN`** (production refuses to start without them). Run the
      migration runner before each deploy. **Check:** `/api/health/ready` → 200, `"database": "ok"`.
- [ ] WooCommerce (P6): nothing to set up — the approval screen calls back to
      **`https://app.tajribah.org/api/connections/woocommerce/callback`**, which only has to be reachable over https.
      **Check:** connect a test WordPress store from Store connections; its products appear after the first sync.
- [ ] Shopify (P6), once a **Shopify Partner account** exists: create the Tajribah app; allowed redirect URL
      **`https://app.tajribah.org/dashboard/connections`**; access scope **`read_products`** only; set
      **`SHOPIFY_CLIENT_ID`** and **`SHOPIFY_CLIENT_SECRET`** on the dashboard Worker — the Shopify card then
      shows its Connect form by itself. Webhooks, in the app's configuration, all to
      **`https://app.tajribah.org/api/webhooks/shopify`**: `products/create`, `products/update`,
      `products/delete`, `app/uninstalled`, and the three privacy topics Shopify requires before a public
      listing — `customers/data_request`, `customers/redact`, `shop/redact` (T58). **Check:** on a development store, connect from Store
      connections; the install screen asks for products only; back on Store connections the note says
      the app is installed and the first sync runs.
- [ ] Salla (P1.4/P1.5, T61), once the **Salla Partner** account exists: create the Tajribah app in the
      Partners portal with **Easy Mode** authorization (the only mode Salla allows published apps) and the
      scopes **`products.read`** and **`offline_access`**. Webhook URL
      **`https://app.tajribah.org/api/webhooks/salla`**, security strategy **Signature**, events
      `app.store.authorize`, `app.uninstalled`, `product.created`, `product.deleted` and the product change
      events (`product.price.updated`, `product.status.updated`, `product.image.updated`, …). Add an
      **Embedded Page** whose iframe URL is **`https://app.tajribah.org/salla/app`** (set it as the default
      page). Then set **`SALLA_APP_ID`**, **`SALLA_CLIENT_ID`**, **`SALLA_CLIENT_SECRET`** and
      **`SALLA_WEBHOOK_SECRET`** on the dashboard Worker — the Salla card shows its steps once all four are
      set. **Check** on a Salla demo store: install the app; open it from the Salla dashboard (Apps →
      Tajribah) — the page says "Link to my Tajribah account"; follow it, sign in; Store connections says
      the store is linked and the first sync runs; the products match the Salla store (names in both
      languages, prices, pictures). Then confirm the four details marked in DECISIONS T61 (listing order,
      time zone, a missing price, the page format) and run `salla.test.ts`'s conformance suite against it.
- [ ] Zid (P6, T61), once the **Zid Partner** account exists: create the Tajribah app; app URL
      **`https://app.tajribah.org/api/connections/zid/activate`** (Zid's Activate opens it and OAuth starts at
      once); allowed redirect URL **`https://app.tajribah.org/api/connections/zid/callback`**; scopes to read
      products and to manage webhooks (`third_webhook_write`). Set **`ZID_CLIENT_ID`** and
      **`ZID_CLIENT_SECRET`** on the dashboard Worker — the Zid card then shows "Connect with Zid". **Check**
      on a Zid demo store: Activate from the Zid App Market → approve → sign in to Tajribah → Store connections
      says the store is linked, the first sync runs, the products match (both names, prices, pictures); edit a
      product in Zid → it updates within a minute (the webhook). Then confirm the four details in DECISIONS T61
      (page size, unpublished products, a missing price, a refused refresh) and capture Zid's uninstall
      message to handle it.
- [ ] Custom domains (P8, T62), with the Cloudflare account: enable **Cloudflare for SaaS** on the zone
      that serves the website (`tajribah.org`); its fallback origin **`domains.tajribah.org`** (or set
      **`CUSTOM_DOMAIN_TARGET`** on the dashboard Worker to the one chosen). On the dashboard Worker set
      **`CLOUDFLARE_SAAS_ZONE_ID`** and **`CLOUDFLARE_SAAS_API_TOKEN`** (a token that may edit that zone's
      custom hostnames) — ready addresses are then switched on by the minute's pass. On the **website**
      Worker set **`SITE_HOSTS=tajribah.org,www.tajribah.org`**, so a store's address serves only its try-on and its products' own pages — and only that store's (unset, no address counts as a store's).
      **Check** with an Enterprise test store and a real subdomain: add the two records → "Check now" says
      ready → within minutes "Live"; the shop's try-on button opens on the store's address; `https://<the
      address>/pricing` lands on tajribah.org; remove the CNAME and check → the button opens on tajribah.org again.
- [ ] The weekly summary by email (P4.8), once the mail provider is set: with a test member whose address
      is confirmed, on a store with full analytics — Analytics → "Email me the week's figures every
      Sunday" → on. **Check** the following Sunday after 08:00 Riyadh: one email arrives, in the member's
      language, with the week (Sunday to Saturday) beside the week before; the log line
      `weekly reports sent`; and no second copy on later passes. (To see one without waiting, set the
      row's `report_subscriptions.last_sent_for` back a week on staging.)
- [ ] Smoke test (P0.20): with a test store's account (no two-step sign-in),
      `node scripts/smoke/smoke.mjs --base https://app.tajribah.org --email … --password …` — every read and a
      merchant's usual changes; it must end "passed".
- [ ] Backups (P7): schedule `scripts/dr/drill.mjs backup`, keep the dumps off the database host and
      encrypted, and run `verify` on a spare server before launch — `docs/DR.md` is the runbook.
- **Check:** sign in; the setup guide loads; `/api/auth/me` answers; eleven wrong passwords for one
  email in a row → the eleventh answers 429 with a `retry-after` header.

## 4. The website and try-on (`tajribah.org` — the same Worker as the dashboard since 2026-10-04)

The website moved into the platform (`site/`, `app/(site)`); there is no second Worker to deploy.
- [ ] Give the dashboard Worker a second R2 binding, **`PAIR_BUCKET`** — a **private** bucket (no public
      access, no custom domain) for the phone-to-computer photos (`site/lib/pair-store.ts`). Never the
      public `BUCKET`: a shopper's photo must not be reachable by a URL. The every-minute cron already
      runs the sweep that deletes expired ones (P5.7, `site/lib/pair-sweep.ts`).
- [ ] Set **`SITE_HOSTS`** on the Worker to Tajribah's own hosts, the website's first:
      `tajribah.org,app.tajribah.org` (T62: any other host is a store's own address, which serves only
      its try-on and products' own pages).
- [ ] Point **`tajribah.org`** at the dashboard Worker (the website is `/`, the dashboard `/dashboard`,
      sign-in `/login`). `app.tajribah.org` may stay pointed at it too, for old links. Shops open the try-on at **`https://tajribah.org/embed/try-on`**
      (`widget/src/tryon.ts` `DEFAULT_TRYON`), which reads configs from `cfg.tajribah.org`.
- [ ] **Products' own pages (P1.19)** are this Worker's `/p/{store}/{product}`, reading the same
      configs. The dashboard shows each published product's link from **`HOSTED_PAGE_BASE`**
      (`https://tajribah.org/p`, set in `deploy/production.jsonc`). **Decided (T106): no separate short domain** —
      printed codes stay on tajribah.org, so a shared link never changes.
      An Enterprise store's own address serves its pages without this (its link is `https://{its address}/p/…`).
- **Check:** a published watch's button on a shop page opens the studio with that watch; a QR photo
  left unclaimed is gone a minute after its 30 minutes (the sweep logs only failures). A published
  product's link from AR settings → "Product page" opens it in 3D (a watch in the studio); switched
  off there, the same link says the page is not available within about a minute.

## 5. Analytics collector (`ev.tajribah.org`, P4.2)

- [ ] Route **`ev.tajribah.org/v1/e`** to the **dashboard Worker** (a custom domain or route on it): the
      collector is served there at `/v1/e` (and at `/api/analytics/collect`) — the address the widget
      ships with (`widget/src/main.ts` `DEFAULT_EVENTS`). No CORS is needed: the widget sends beacons.
- **Check:** open a shop page with a published button on a phone; within a few seconds of leaving the
  page the event is in `analytics_events` (staging); within five minutes (the roll-up window) the
  analytics screen counts the view, "In your shop right now" shows it at once, and the setup guide's
  last step ticks. A request from `curl` is answered 204 and stored nowhere (robots are dropped).

## 6. DNS summary

| Name | Serves |
|---|---|
| `tajribah.org` | the one Worker: website + try-on (`/`) and dashboard (`/dashboard`) |
| `app.tajribah.org` | the same Worker (optional, for old links) |
| `cdn.tajribah.org` | R2, public |
| `cfg.tajribah.org` | config host Worker |
| `ev.tajribah.org` | event collector (P4.2) |
