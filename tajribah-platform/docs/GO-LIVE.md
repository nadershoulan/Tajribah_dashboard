# Going live on Cloudflare — the checklist

Everything the code already expects once the Cloudflare account and the domains exist, in the
order it can be done. Each line names where the expectation lives in the code and how to check it
worked. Nothing here is a new decision: hosts and names are the ones the code uses today (T29:
the website and the try-on on **tajribah.com**, the dashboard on **app.tajribah.com**, services on
**tajribah.com**).

## 1. Storage — R2 and the CDN (`cdn.tajribah.com`)

- [ ] Create the R2 bucket; bind it to the dashboard Worker as **`BUCKET`**
      (`server/core/http/bootstrap.ts`, `cloudflare-env.d.ts`).
- [ ] Serve it publicly at **`cdn.tajribah.com`**; set **`CDN_BASE_URL=https://cdn.tajribah.com`** and
      **`STORAGE_PROVIDER=r2`** (`server/core/config/env.ts` refuses memory storage in production).
- [ ] R2 S3 API token (Object Read & Write, this bucket only) → **`R2_ACCOUNT_ID`**, **`R2_BUCKET_NAME`**,
      **`R2_ACCESS_KEY_ID`**, **`R2_SECRET_ACCESS_KEY`** — without them the browser cannot upload
      straight to storage (presigned PUT, `server/core/storage/sigv4.ts`).
- [ ] Bucket CORS: allow `PUT` with `content-type` from `https://app.tajribah.com` — the dashboard's
      model and cut-out uploads are browser PUTs to presigned URLs on another origin.
- [ ] Upload the storefront files (paths are what the widget asks for, `widget/src/main.ts`):
  - `w/v1/widget.js` ← `node widget/build.mjs` → `widget/dist/widget.js`
  - `vendor/model-viewer-4.0.0.min.js` and `vendor/meshopt_decoder-1.2.0.js` ← `public/vendor/`
    (sources and licences in `public/vendor/README.md`; the build refuses a decoder version mismatch).
- **Check:** `https://cdn.tajribah.com/w/v1/widget.js` loads; an uploaded model's public URL loads;
  the model library shows a file's size after an upload.

- **Check (P1.13b, T65):** upload a GLB, publish it, and open its product page in the shop **on an iPhone**: the button opens Quick Look straight away (no viewer
  first) and the product stands in the room at its real size. The USDZ is `v{n}/model.usdz` beside `optimized.glb`.

## 2. Viewer configs — KV and the config host (`cfg.tajribah.com`, P1.15)

- [ ] Create one KV namespace. Bind it as **`CONFIGS`** to the dashboard Worker, and put its id in
      `wrangler.config-host.jsonc` (the placeholder `REPLACE_WITH_THE_CONFIGS_NAMESPACE_ID`).
- [ ] Set **`CONFIG_STORE=kv`** on the dashboard (memory is refused in production).
- [ ] Deploy the config host: `wrangler deploy --config wrangler.config-host.jsonc`; route
      **`cfg.tajribah.com/v1/*`** to it.
- **Check:** publish a product in AR settings → `https://cfg.tajribah.com/v1/{store}/{product}.json`
  answers 200 with `access-control-allow-origin: *` and `cache-control: public, max-age=60`; an
  unknown product answers 404. (Seen in workerd over a local KV on 2026-09-29 — STATE.)

## 3. The dashboard (`app.tajribah.com`)

- [ ] Deploy the dashboard Worker; point **`app.tajribah.com`** at it; set **`APP_URL`**.
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
      **`https://app.tajribah.com/api/health`** (answering) and **`/api/health/ready`** (503 while the database
      cannot answer). In the log service, alert on the share of `slow request` lines per path
      (`server/core/observability/slo.ts` holds the plan's targets).
- [ ] The database (T60, `docs/DATABASE.md`): on the chosen host, create the database, run
      `node scripts/db/migrate.mjs --db …`, create the two logins; bind two Hyperdrive configurations as
      **`HYPERDRIVE_APP`** and **`HYPERDRIVE_ADMIN`** (production refuses to start without them). Run the
      migration runner before each deploy. **Check:** `/api/health/ready` → 200, `"database": "ok"`.
- [ ] WooCommerce (P6): nothing to set up — the approval screen calls back to
      **`https://app.tajribah.com/api/connections/woocommerce/callback`**, which only has to be reachable over https.
      **Check:** connect a test WordPress store from Store connections; its products appear after the first sync.
- [ ] Shopify (P6), once a **Shopify Partner account** exists: create the Tajribah app; allowed redirect URL
      **`https://app.tajribah.com/dashboard/connections`**; access scope **`read_products`** only; set
      **`SHOPIFY_CLIENT_ID`** and **`SHOPIFY_CLIENT_SECRET`** on the dashboard Worker — the Shopify card then
      shows its Connect form by itself. Webhooks, in the app's configuration, all to
      **`https://app.tajribah.com/api/webhooks/shopify`**: `products/create`, `products/update`,
      `products/delete`, `app/uninstalled`, and the three privacy topics Shopify requires before a public
      listing — `customers/data_request`, `customers/redact`, `shop/redact` (T58). **Check:** on a development store, connect from Store
      connections; the install screen asks for products only; back on Store connections the note says
      the app is installed and the first sync runs.
- [ ] Salla (P1.4/P1.5, T61), once the **Salla Partner** account exists: create the Tajribah app in the
      Partners portal with **Easy Mode** authorization (the only mode Salla allows published apps) and the
      scopes **`products.read`** and **`offline_access`**. Webhook URL
      **`https://app.tajribah.com/api/webhooks/salla`**, security strategy **Signature**, events
      `app.store.authorize`, `app.uninstalled`, `product.created`, `product.deleted` and the product change
      events (`product.price.updated`, `product.status.updated`, `product.image.updated`, …). Add an
      **Embedded Page** whose iframe URL is **`https://app.tajribah.com/salla/app`** (set it as the default
      page). Then set **`SALLA_APP_ID`**, **`SALLA_CLIENT_ID`**, **`SALLA_CLIENT_SECRET`** and
      **`SALLA_WEBHOOK_SECRET`** on the dashboard Worker — the Salla card shows its steps once all four are
      set. **Check** on a Salla demo store: install the app; open it from the Salla dashboard (Apps →
      Tajribah) — the page says "Link to my Tajribah account"; follow it, sign in; Store connections says
      the store is linked and the first sync runs; the products match the Salla store (names in both
      languages, prices, pictures). Then confirm the four details marked in DECISIONS T61 (listing order,
      time zone, a missing price, the page format) and run `salla.test.ts`'s conformance suite against it.
- [ ] Zid (P6, T61), once the **Zid Partner** account exists: create the Tajribah app; app URL
      **`https://app.tajribah.com/api/connections/zid/activate`** (Zid's Activate opens it and OAuth starts at
      once); allowed redirect URL **`https://app.tajribah.com/api/connections/zid/callback`**; scopes to read
      products and to manage webhooks (`third_webhook_write`). Set **`ZID_CLIENT_ID`** and
      **`ZID_CLIENT_SECRET`** on the dashboard Worker — the Zid card then shows "Connect with Zid". **Check**
      on a Zid demo store: Activate from the Zid App Market → approve → sign in to Tajribah → Store connections
      says the store is linked, the first sync runs, the products match (both names, prices, pictures); edit a
      product in Zid → it updates within a minute (the webhook). Then confirm the four details in DECISIONS T61
      (page size, unpublished products, a missing price, a refused refresh) and capture Zid's uninstall
      message to handle it.
- [ ] Custom domains (P8, T62), with the Cloudflare account: enable **Cloudflare for SaaS** on the zone
      that serves the website (`tajribah.com`); its fallback origin **`domains.tajribah.com`** (or set
      **`CUSTOM_DOMAIN_TARGET`** on the dashboard Worker to the one chosen). On the dashboard Worker set
      **`CLOUDFLARE_SAAS_ZONE_ID`** and **`CLOUDFLARE_SAAS_API_TOKEN`** (a token that may edit that zone's
      custom hostnames) — ready addresses are then switched on by the minute's pass. On the **website**
      Worker set **`SITE_HOSTS=tajribah.com,www.tajribah.com`**, so a store's address serves only its try-on and its products' own pages — and only that store's (unset, no address counts as a store's).
      **Check** with an Enterprise test store and a real subdomain: add the two records → "Check now" says
      ready → within minutes "Live"; the shop's try-on button opens on the store's address; `https://<the
      address>/pricing` lands on tajribah.com; remove the CNAME and check → the button opens on tajribah.com again.
- [ ] The weekly summary by email (P4.8), once the mail provider is set: with a test member whose address
      is confirmed, on a store with full analytics — Analytics → "Email me the week's figures every
      Sunday" → on. **Check** the following Sunday after 08:00 Riyadh: one email arrives, in the member's
      language, with the week (Sunday to Saturday) beside the week before; the log line
      `weekly reports sent`; and no second copy on later passes. (To see one without waiting, set the
      row's `report_subscriptions.last_sent_for` back a week on staging.)
- [ ] Smoke test (P0.20): with a test store's account (no two-step sign-in),
      `node scripts/smoke/smoke.mjs --base https://app.tajribah.com --email … --password …` — every read and a
      merchant's usual changes; it must end "passed".
- [ ] Backups (P7): schedule `scripts/dr/drill.mjs backup`, keep the dumps off the database host and
      encrypted, and run `verify` on a spare server before launch — `docs/DR.md` is the runbook.
- **Check:** sign in; the setup guide loads; `/api/auth/me` answers; eleven wrong passwords for one
  email in a row → the eleventh answers 429 with a `retry-after` header.

## 4. The website and try-on (`tajribah.com` — the same Worker as the dashboard since 2026-10-04)

The website moved into the platform (`site/`, `app/(site)`); there is no second Worker to deploy.
- [ ] Give the dashboard Worker a second R2 binding, **`PAIR_BUCKET`** — a **private** bucket (no public
      access, no custom domain) for the phone-to-computer photos (`site/lib/pair-store.ts`). Never the
      public `BUCKET`: a shopper's photo must not be reachable by a URL. The every-minute cron already
      runs the sweep that deletes expired ones (P5.7, `site/lib/pair-sweep.ts`).
- [ ] Set **`SITE_HOSTS`** on the Worker to Tajribah's own hosts, the website's first:
      `tajribah.com,app.tajribah.com` (T62: any other host is a store's own address, which serves only
      its try-on and products' own pages).
- [ ] Point **`tajribah.com`** at the dashboard Worker (the website is `/`, the dashboard `/dashboard`,
      sign-in `/login`). `app.tajribah.com` may stay pointed at it too, for old links. Shops open the try-on at **`https://tajribah.com/embed/try-on`**
      (`widget/src/tryon.ts` `DEFAULT_TRYON`), which reads configs from `cfg.tajribah.com`.
- [ ] **Products' own pages (P1.19)** are this Worker's `/p/{store}/{product}`, reading the same
      configs. The dashboard shows each published product's link from **`HOSTED_PAGE_BASE`**
      (default `https://tajribah.com/p`). Decide the short domain *before* merchants start sharing
      links: point it at this Worker with a rule that maps `/{store}/{product}` to `/p/{store}/{product}`
      (or serve `/p` there), then set `HOSTED_PAGE_BASE` to it — a shared link should never change.
      An Enterprise store's own address serves its pages without this (its link is `https://{its address}/p/…`).
- **Check:** a published watch's button on a shop page opens the studio with that watch; a QR photo
  left unclaimed is gone a minute after its 30 minutes (the sweep logs only failures). A published
  product's link from AR settings → "Product page" opens it in 3D (a watch in the studio); switched
  off there, the same link says the page is not available within about a minute.

## 5. Analytics collector (`ev.tajribah.com`, P4.2)

- [ ] Route **`ev.tajribah.com/v1/e`** to the **dashboard Worker** (a custom domain or route on it): the
      collector is served there at `/v1/e` (and at `/api/analytics/collect`) — the address the widget
      ships with (`widget/src/main.ts` `DEFAULT_EVENTS`). No CORS is needed: the widget sends beacons.
- **Check:** open a shop page with a published button on a phone; within a few seconds of leaving the
  page the event is in `analytics_events` (staging); within five minutes (the roll-up window) the
  analytics screen counts the view, "In your shop right now" shows it at once, and the setup guide's
  last step ticks. A request from `curl` is answered 204 and stored nowhere (robots are dropped).

## 6. DNS summary

| Name | Serves |
|---|---|
| `tajribah.com` | the one Worker: website + try-on (`/`) and dashboard (`/dashboard`) |
| `app.tajribah.com` | the same Worker (optional, for old links) |
| `cdn.tajribah.com` | R2, public |
| `cfg.tajribah.com` | config host Worker |
| `ev.tajribah.com` | event collector (P4.2) |
