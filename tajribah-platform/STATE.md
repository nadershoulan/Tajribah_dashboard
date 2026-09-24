# Tajribah — state

**One state file. Update it every session** (§13.7.4). `PROGRESS.md` is the plain-language
view of the same facts for Nader — update it in the same session. Counts are derived from
`docs/PACKAGES.md`, never incremented by hand.

| | |
|---|---|
| Spec | `../../TAJRIBAH-BUILD-PLAN.md` |
| Stack deviations | `docs/ARCHITECTURE.md` |
| Decisions | `docs/DECISIONS.md` (T9: Postgres + RLS, reversing T1) |
| Packages | `docs/PACKAGES.md` |
| Current phase | **P0 — Foundation** (gate run: code **passed**, full gate **not passed** — `docs/gates/P0.md`) |
| Gate not yet passed | P0 |

> **Gate override in force (T12).** P0's code gate passed; its infrastructure half (CI,
> staging) did not. Nader chose to start **account-free P1 packages** meanwhile. This is not a
> passed gate: re-run `docs/gates/P0.md` before P1's own gate.

## Progress

| Phase | Done / total |
|---|---|
| P0 Foundation | **19 / 22 done, P0.20 partly** — its last browser step needs a database; P0.21 CI / P0.22 staging need accounts |
| P1 Core loop | **7 / 26** + P1.6b (account-free work only, T12) · P1.13b needs a decision |
| later | not opened |

## Next up

Everything in P0 that this machine can build and verify is built and verified — including,
since 2026-09-23, **lint, the full typecheck and the Next dev server** (portable Node 22, see
below). What is left needs a decision or an account: a Postgres host (the dev Worker has no
database, so sign-in → dashboard → sign-out cannot finish in a browser — the last step of
P0.20), a CI runner (P0.21), Cloudflare (P0.22 staging).
**P1 does not start until the full gate passes** — see `docs/gates/P0.md`.


**Done and verified**

| ID | Package | Verified by |
|---|---|---|
| P0.1 | Repo scaffold, conventions, docs | `tsc` clean |
| P0.2 | Config & secrets — registry + zod loader (all problems at once), `.env.example` rendered from the registry, `scripts/gen-env-example.mjs [--check]`; `.gitignore` no longer swallows `.env.example` | 5 tests; **seen to fail**: hand-edited template → red and `--check` exit 1, registry grown without regenerating → red, loader cut to first problem → 2 red |
| P0.3 | Error model (RFC 9457 problem+json) | used by the suites below |
| P0.4 | Database layer — Postgres, 50 tables, `0000_init.sql` + generated `0001_rls.sql` (39 policies, roles `tajribah_app` / `tajribah_admin`), both with `-- ROLLBACK:` | both migrations applied by the PGlite harness on every run |
| P0.5 | Tenancy core — `withTenant` (RLS, transaction-local GUC), `TenantDb`, `TenantContext` | isolation suite |
| P0.6 | **Isolation suite** — walks the schema; RLS and `TenantDb` tested separately | 90 pass; **seen to fail** three ways: policies `USING (true)` → 42 failures, predicate no-op → 43, app role BYPASSRLS → 43 |
| P0.7 | Auth crypto — PBKDF2, HMAC JWT, AES-GCM, OTP | 12 unit tests incl. tamper, expiry, `alg:none` |
| P0.8 | Sessions and auth flows — rotation with **full-family** reuse detection | 14 tests incl. replay of an older token |
| P0.9 | Notification adapters — GSM 03.38 part counting, bilingual OTP SMS + verify/reset emails, templates length-checked at load, `configureNotify(env)` | 11 tests; **seen to fail**: UCS-2 limit set to 160 → 2 red, console sender silenced → 1 red, Arabic OTP padded to 88 chars → the module refuses to load |
| P0.10 | RBAC — roles, permissions, `requirePermission` | used by the context; table is data in `lib/permissions.ts` |
| P0.11 | Audit logging — `auditedInsert/Update/Delete`: change + audit row in one `withTenant` transaction; a scan fails any `ctx.db` write in `server/modules` | 7 tests; **seen to fail**: duplicate row → 3 red, audit in a second transaction → the rollback test red, an unaudited `ctx.db.updateById` in a service → the scan red with file:line |
| P0.12 | Plan entitlements and quotas | typechecked; quota refusal not yet exercised by a test |
| P0.13 | **Job framework** — rows first, fair claiming, backoff, dead letter, worker entry point | 10 tests incl. queue fairness under a 50-job flood |
| P0.14 | Storage — `forTenant()` refuses keys outside `t/{tenant}/` (incl. `..` and `//`), R2 + memory adapters, SigV4 presigned PUT on WebCrypto (content type bound, ≤ 1 h), `configureStorage(env, BUCKET)` | 8 tests: upload + read back on memory **and** R2 (through a fake `R2Bucket` — real R2 not exercised, no account); presigner matches the **AWS documentation test vector**; **seen to fail**: tenant check no-op → 2 red, `..` check removed → 2 red, stream bug restored → 1 red, signing string altered → vector red |
| P0.15 | i18n core — Arabic default, RTL, SAR/Hijri/`+966` formatters, digit folding | rendered in both mirrors |
| P0.16 | Design system — tokens, dashboard kit | screenshots, desktop + phone + LTR |
| P0.17 | Dashboard skeleton — shell, sidebar, tenant switcher, 11 screens | screenshots |
| P0.18 | Observability — `AsyncLocalStorage` request scope stamped on every log line, `route()` wrapper (id in/out, access line, error hook → problem+json), jobs inherit the enqueuing request's id | 5 tests incl. 20 concurrent requests; **seen to fail**: logger ignores scope → 4 red, no per-request scope → 4 red, runner drops the id → 1 red, every error logged as a crash → 1 red |
| P0.19 | API skeleton — 9 auth endpoints (`app/api/auth/**`, API-001…009) as tested `(Request) => Response` handlers in `server/modules/auth/http.ts`; `server/core/http/api.ts` (config, zod bodies → 422, same-origin check, `authenticate` loads the session every request, `tenantContextFor`); `bootstrap()` + `server/boot.ts` (the only `cloudflare:workers` import) | 13 tests; **seen to fail** 5 ways (token trusted without its session → 2 red, same-origin off → 1, switch skips membership → 1, logout not revoking → 1, refresh token in the body → 1) + a removed route file → red |
| P0.20 ◐ | Dashboard ↔ API — `lib/api-client.ts` (token in memory, one shared refresh on 401, typed `ApiError`), `lib/auth.tsx` (`AuthProvider` / `DemoAuthProvider`), `RequireSession` inside `Shell` (→ `/login?next=`), `apiSource` (store summary real; other screens 501 until P1), Login/Register wired, sidebar Sign out, shared `components/routes.tsx`, Next shell (`app/layout.tsx`, `app/[[...path]]/page.tsx`, `components/next-shell.tsx`) | 4 end-to-end tests: real client → real handlers → Postgres, incl. reload-restores-session and 5 concurrent 401s sharing one refresh; **seen to fail** 3 ways; preview screenshots of login with `?next=` and the Sign out button. **Browser run (Node 22, workerd dev server):** `/login` renders (200, `lang=ar dir=rtl`); `/dashboard` signed out → exactly one refresh (401) → client redirect to `/login?next=%2Fdashboard`. **Not run:** submitting sign-in in a browser — needs a database |

**Filed, not fixed (outside the package that found them):**
- PGlite is one connection: inside `withTenant`, any call on `unsafeAdminDb()` deadlocks
  in tests (on real Postgres it would be a second connection). Nothing does this today.
- Auth events (`login`, `logout`) are not audited yet — they have no `TenantContext`.
- (P1.3) Transport circuit and rate-limit state live in memory, per `Transport` instance —
  on Workers that is per isolate, so two isolates syncing one store each get the full
  bucket. P1.6 must either keep one connection's sync on one worker or move the bucket to
  KV/Durable Objects.
- (P1.3) `ENCRYPTION_KEY` has no rotation: one key, `v1` envelopes. Changing it turns every
  connection to `error` (tokens unreadable → reconnect). Needs a key id in the envelope
  before the first real merchant connects.
- ~~(P1.6) A crash between committing a sync row and enqueueing its job leaves it stuck~~ —
  closed by P1.6b: the schedule re-enqueues a sync idle for 15 minutes.
- (P0.13, corrected 2026-09-24) `enqueue` checks `dedupeKey` by select-then-insert, and
  `jobs.dedupe_key` **does** have a unique index — so two concurrent enqueues with one key
  do not both insert: the second **throws** a unique violation instead of returning the
  existing job. (The earlier note here said they could both insert; that was wrong.)
- (P1.7) A failing webhook handler is retried on the next worker tick with no backoff — five
  attempts can go in five seconds. Handlers are local database work, so this is rare; add
  backoff if a handler ever calls out.
- (P1.7) `dispatchPending` takes the oldest 50 events across all tenants — one store's flood
  delays others. Apply the queue's `FAIR_SHARE` rule if that shows up.
- (P1.12) A `draft` version whose bytes never arrive stays `draft` forever (the URL expires
  after 15 min). A cleanup tick should fail drafts older than a day.
- (P1.12) No storage quota check on upload: `storage_gb` is metered per period, which is the
  wrong shape for "bytes held". Decide with P2 billing.
- (P1.13) The optimiser must run in the **Node** worker (the plan's Hetzner container), not in
  a Cloudflare Worker: `ndarray-pixels` (pulled in by `@gltf-transform/functions`) imports the
  native `sharp` at load. Nothing bundles the worker for Workers today; keep it that way.
- (P1.13) `model_versions` has no `error` column: why a version failed is only in its audit
  row and the log. The model library UI (P1.14) will want it on the row.
- (P1.3) The `accessTokenFor` row lock is untested (see P1.3 row) — add a two-connection
  test once real Postgres exists.

**Production database:** `bootstrap()` does not register one — no host/driver chosen (T9). The first query on a deployed Worker fails with "No database registered".

**Not wired yet (belongs to later packages):** nothing calls `sendSms`/`sendEmail` — auth
returns the verification token and a route handler will send it; `configureNotify` has no
boot to be called from until the first route handler exists; the `notify.email` /
`notify.sms` queues have no handler.

**P1 — done and verified (under the T12 override)**

| ID | Package | Verified by |
|---|---|---|
| P1.1 | Onboarding state machine — `server/modules/onboarding/{machine,service,http}.ts`, API-020…023. Steps are done by database fact (active connection, product with width+height mm, ready model, widget `product_view`), only `store` and skips are stored; only `plan`/`connect` skippable; changes need `settings:write` and are audited | 6 tests incl. another store's facts not counting; **seen to fail** 4 ways (expired connection counted, width alone counted, catalogue skippable, no permission check) |

| P1.3 | Connector abstraction — token vault `server/modules/connections/vault.ts` (AES-256-GCM, each token **bound to its connection id** as GCM additional data — `encryptSecret/decryptSecret` gained `boundTo`); connection model `server/modules/connections/service.ts`: `connectStore` (one store ↔ one account via the global unique index → 409; reconnect reuses the row), `listConnections` → `ConnectionSummary` built field by field, `disconnectStore` wipes tokens, `accessTokenFor` refreshes 5 min before expiry under `TenantDb.lockById` (`SELECT … FOR UPDATE`) and re-reads after waiting; a refused refresh / unreadable tokens / expired-without-refresh → tokens wiped, status set, audited as `system`, `ReconnectRequiredError` (409). Transport (`server/connectors/transport.ts`, pre-existing, first tests): **fixed** — a POST whose connection dropped after the store read it was retried (fetch reports it as the same `TypeError` as a refused connection); now only `ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN` count as never sent | 10 transport tests against a real local HTTP server + injected clock (timeout, retry/backoff, Retry-After, no POST retry, circuit open/half-open/single trial, per-connection bucket, queue refusal); 8 connection tests on PGlite + 1 crypto. **Seen to fail** 13 ways: timeout ignored, POST idempotent, circuit never opens, half-open unguarded, one bucket for all, Retry-After ignored, dropped POST retried (fixed bug), refresh without re-check, id binding removed, refusal thrown inside the transaction, summary spreads the row, 23505 unmapped, disconnect keeps tokens. **Not proven:** the row lock itself — removing it stays green, because PGlite is one connection and runs transactions one at a time; needs real Postgres |
| P1.6 | Sync engine — `server/modules/sync/{engine,service,job}.ts`. One page = one transaction (products, `sync_job_items`, cursor + counters); a page applies only if the job's cursor is unchanged under a row lock (duplicate runs are harmless); 20 pages per queue job, then a continuation keyed by cursor; last queue attempt marks the sync failed. Store owns name/SKU/price/description/images/status only. Full sync archives what the store dropped, **unless > 50% would go** (then nothing, reason on the job + connection). Plan limit → failed items naming the limit; invalid items (currency, negative or > int4 price) fail alone. `requestSync` (one active sync per store, first sync always full), `syncProgress`/`latestSync` → `SyncProgress` view model. New: `systemContext` (background work, explicit permissions, audited as `system`), `Page.total`, `server/testing/fake-store.ts`. **Fixed on the way (P0.12 bug, blocked this package):** `entitlementsOf`/`planCodesFor` matched plan codes against the uuid `plan_id`, so every subscriber was Starter — now read from `plans.code` | 9 sync tests incl. **10,000 products through the real worker loop** (5 jobs, 20% progress after the first, 100 fetches, every product once) + 1 entitlements test (seen red first). **Seen to fail** 14 ways: cursor check off, page outside a transaction, sync overwrites `arEnabled`, archive guard off, plan limit ignored, no item validation, incremental ignores `since`, `lastSyncAt` not stamped, no continuation, last attempt not marked, two active syncs, suspended tenant syncs, system audited as user, finished sync re-runs |
| P1.6b | Sync schedule + partitioning — `server/modules/sync/schedule.ts`, called by the worker every tick (`runOnce`) / once a minute (`runForever`). Due = active, no sync queued/running or finished within the interval, `last_sync_at` older than the interval (never-synced first). Stalled sync (idle 15 min) re-enqueued once per stall (dedupe key = its heartbeat). One store's error never stops the tick. **`drizzle/0002_partition_sync_job_items.sql`**: table rebuilt `PARTITION BY RANGE (created_at)`, PK `(id, created_at)`, DEFAULT partition, `ensure_sync_job_items_partition(date)` SECURITY DEFINER (admin role only), this month + 2 created before the copy and kept ahead by every tick; RLS policy, FORCE and **both** roles' grants re-applied (0001's `ON ALL TABLES` grant does not reach a later table). Rollback rebuilds the flat table with rows; the rollback runner now also runs `CREATE`/`INSERT`/`GRANT` lines. **Isolation walk fixed**: it read `relkind = 'r'` only and silently lost the partitioned parent; now `('r','p')`, plus a new generic check that no partition of a tenant table is granted directly (§13.2) | 5 schedule + 3 partition tests + 1 isolation check. **Seen to fail**: failed store retried every tick, interval ignored, stall re-enqueued every tick, stale threshold zero, one error stops the tick, stalls never re-enqueued, partitions not kept ahead; policy not re-applied, not FORCEd, admin not re-granted, a partition granted to the app, function not SECURITY DEFINER, months not pre-created, rollback forgets the policy. **Stays green by design:** removing the query's busy-store filter — `createSyncIn` is the guard (seen red in P1.6) |
| P1.7 | Webhook ingestion (generic) — `server/modules/webhooks/{sources,ingest,dispatch,service,http}.ts`, API-040 `POST /api/webhooks/[provider]`. HMAC-SHA256 over the **raw body** (`request.text()`), constant-time; **forged deliveries refused (401) and not stored** (T13); dedup by `UNIQUE(provider, provider_event_id)` → 200 `duplicate`; unknown store → 200 dropped; > 256 KB / not JSON / no event id → 422. Worker (`worker/main.ts`) dispatches each stored event under `TenantDb.tryLockById` (`FOR UPDATE SKIP LOCKED`) in the handling transaction; after-commit effects for enqueueing. Handlers: product created/updated → one incremental sync (`createSyncIn`), product deleted → archived, app uninstalled → connection revoked (`revokeIn`), anything else ignored. 5 attempts then `failed`; `replayWebhook` = status change, refuses unsigned rows; `webhookHealth` (24 h counts, last failure). No real provider source yet — Salla's header/envelope wait on P1.4 🔒 | 7 tests through the real HTTP handler. **Seen to fail** 13 ways: signature always passes, missing header accepted, signature over re-serialised JSON (in ingest, and in the handler), duplicate unrecognised, unknown store errors, size limit off, enqueue dropped, claimed event not re-checked, attempts never run out, forged row replayable, deletion not archived, uninstall not revoking |
| P1.13 | Model processing — `server/modules/models/{optimize,process}.ts`; a successful confirm enqueues `ai.postprocess` after its commit (dedupe per version). GLB: gltf-transform `prune, dedup, weld, meshopt` → `v{n}/optimized.glb` as its own `model_files` row (`optimized`, `meshopt`); version gets triangles **as drawn** (scene walk), materials, textures, bounds, and becomes `ready` — never live. USDZ: marked ready as uploaded. Unreadable GLB → `failed` for good; storage error → thrown for the queue to retry. Size report on `modelVersionsOf` (original/optimised bytes, `withinTarget` ≤ 2 MB). New deps (T14): gltf-transform 4.5.0 ×3, meshoptimizer 1.2.0 — declared by hand in `package.json` because `pnpm add` stalled on the registry (70–190 s requests); the packages were already linked. Test runner: `sharp` (via ndarray-pixels) kept external, pinned to its importer's path | 5 tests incl. a real wasteful GLB (2 × unindexed 20×20 grid + unused material) → one shared 441-vertex mesh, decoded again with the meshopt decoder. **Seen to fail** 13 ways, incl. triangles counted per stored mesh (found a real bug first), no weld/dedup, confirm not queueing, unreadable file retried forever, storage error marked failed, ready version going live, both idempotency layers, size report inverted |
| P1.12 | Manual 3D upload — `server/modules/models/{inspect,service,http}.ts`, API-050 `POST /api/models/uploads`, API-051 `POST /api/models/versions/[id]/confirm`. Start: `.glb`/`.usdz` only, ≤ 50 MB, product/model must be this store's; next version under a lock on the model row (one model per product); `draft` version + `original` file row; presigned PUT (15 min, content type bound) into `t/{tenant}/model/{model}/v{n}/`. Confirm: object must exist (else 409), first 286 bytes inspected — GLB magic, glTF 2, declared length = stored size (catches truncation), JSON first chunk; USDZ = stored zip whose first entry is `.usd[ac]`. Refused → bytes deleted, version `failed` with the reason; accepted → `processing` (P1.13 picks it up). An upload never sets `current_version_id`. Confirm is idempotent (early return + re-check under lock) | 6 tests with real GLB/USDZ bytes built to spec. **Seen to fail** 13 ways: GLB magic, declared length, glTF version, USDZ compression, USDZ first entry, refused bytes kept, confirm without the object, confirm not idempotent (both layers — one alone is masked by the other), size limit, extension, permission, a new model per upload, upload makes itself live. **Not provable on PGlite:** the version-numbering lock (removing it stays green; transactions run one at a time) |
| P1.8 | Products domain — `lib/contracts/products.ts` (zod), `server/modules/products/{service,http}.ts`, API-030…034 (`/api/products`, `/api/products/[id]` GET/PATCH/DELETE). Keyset paging on uuid v7 id; search across name/name_ar/sku with `%`/`_` escaped; filters + counts; model status and 30-day numbers from `models_3d` / `daily_product_stats`. Rules: AR needs width+height mm; store-owned fields (name, name_ar, sku, price) refused on synced products; soft delete that wins over a later status change; quota on create; roles (`products:delete` is admin). `apiSource.products()/product()` now real | 8 tests incl. 26 rows paged 10 at a time with no skip/repeat; **seen to fail** 6 ways — and one break (deleted rows listed) first stayed green, exposing a test gap that was then closed |

**Next in P1 (account-free):** P1.9 / P1.10 products UI → P1.11 connections UI → P1.14
model library UI. **P1.13b waits on a decision:** what goes in the worker's container image.

## Screens built (preview)

`MD-001` home · `MD-010` products · `MD-030` connections · `MD-040` models ·
`MD-100` install · `MD-120` analytics · `MD-150` team · `MD-160` billing ·
`MD-170` settings · `AUTH-001` sign in · `AUTH-002` register · `SYS-404`.

They render against seeded demo data (`lib/demo-data.ts`) through the same components the
Next app will use; the preview carries a visible "demo data" badge.

## Blocked on external accounts (§12)

Nothing in P0 is blocked. These block P1 and later, and should be opened now:

| # | Account | Blocks | Status |
|---|---|---|---|
| 1 | Salla Partner + app registration | Salla OAuth, the entire core loop | not started |
| 2 | Cloudflare (R2 + Workers + KV + DNS) | storage, edge config, the shopper path | not started |
| 3 | `tajribah.com` + a short domain | hosted AR pages, QR, email links | not started |
| 4 | Moyasar merchant account | 11 of 15 billing packages | not started |
| 5 | ZATCA Fatoora onboarding + CSID | e-invoicing | not started |
| 6 | Unifonic (SMS/WhatsApp) | phone OTP | not started |
| 8 | 3D generation API (Meshy/Tripo3D/CSM) | the whole 3D phase | not started |

**Before spending on any of them: confirm the name is free** — `.com` and `.sa`, the short
domain, the app name on the Salla and Zid partner portals, and a Saudi trademark search.

## Local toolchain

| | | |
|---|---|---|
| Node ≥ 22.13 | **macOS machine (2026-09-23): system Node 24.9 works directly** — `corepack pnpm install --no-lockfile` (pnpm 11.25), then `node scripts/verify.mjs --modules node_modules`. Windows machine: system has **20.15**; a portable **22.23.2** works from the session scratchpad | download `node-v22.23.2-win-x64.zip` from nodejs.org (verify SHA-256), unzip, put it first on `PATH` as a `/c/...` path |
| pnpm | **11.25.0** via Node 22's corepack | `corepack pnpm install --no-lockfile` — no lockfile is committed yet |
| Project install | `node_modules` + `.sites-runtime/` (both gitignored) | ~2 min |
| Dev server | `node scripts/run-framework.mjs dev` → http://localhost:5173 on workerd | reads `.dev.vars` (gitignored; dev-only random secrets) |
| Docker | unverified | not needed: PGlite runs real Postgres in process (T9) |
| Production Postgres | **not chosen** | nothing registers a database outside tests, so API calls that touch the DB return 500 "No database registered" in dev too |

Verification: `node scripts/verify.mjs --modules node_modules` on Node 22 runs everything
(typecheck of the full `tsconfig.json`, tests, generated-file checks, **lint**). The Node 20 +
scratch-toolkit route still works and says when it skipped lint. First request after a cold
dev start once failed with a cached `internal error; reference = …` for every route; a restart
cleared it — if it recurs, restart before debugging.

## Session log

| Date | Did | Verified |
|---|---|---|
| 2026-09-22 | Read the plan. Created this repo from the `tajribah-try-on` starter skeleton. Wrote ARCHITECTURE, DECISIONS (T1–T6), PACKAGES, this file. | — |
| 2026-09-22 | P0.4 schema + migration with `-- ROLLBACK:`. P0.5 `TenantDb`. P0.6 isolation suite. P0.3 problem+json. P0.7 crypto. P0.13 queue + runner + worker entry point. | `tsc` **0 errors**; **68 pass / 0 fail**; isolation suite **seen to fail** (43 failures) with the tenant predicate deliberately broken, then restored |
| 2026-09-22 | P0.8 sessions and auth flows. Reworked refresh rotation onto a `refresh_tokens` table after a test caught that remembering one previous hash misses an older stolen token; regenerated `0000_init.sql` (nothing had been deployed). P0.10/P0.12 entitlements. P0.15–P0.17 i18n, design system, dashboard shell and 11 screens. Static preview builder. | `tsc` **0 errors**; **82 pass / 0 fail**; screenshots at desktop, 500 px and LTR |
| 2026-09-22 | Found an unrecorded, half-finished move from D1 to **Postgres + RLS** (PGlite harness, generated RLS migration); suite was **70 pass / 56 fail**. Finished it: added the `tajribah_admin` role (generator + regenerated `0001_rls.sql`), split `db/client.ts` into app/admin handles, `withTenant` → app role. Fixed test-side port bugs: FK-aware seeding, `pg_roles` not `pg_user` for a NOLOGIN role, date/char columns in `synthRow`, `close()` → `harness.close()`. No service logic changed. Recorded T9; updated ARCHITECTURE, CLAUDE.md, README; `@electric-sql/pglite` added as a devDependency. | `tsc` **0 errors**; **126 pass / 0 fail**; isolation suite seen to fail three ways (see P0.6), files restored byte-identical |
| 2026-09-22 | P0.9 notification adapters. Replaced the `needsUcs2` regex (raw control bytes; counted `` ` `` as GSM and `[]{}\^~\|€` as one septet) with explicit GSM basic/extension sets. Added `messages.ts` (OTP SMS, verify + reset email, ar/en), `configureNotify`, an E.164 guard on both SMS senders, `EMAIL_FROM` and `UNIFONIC_SENDER_ID` in the env registry. No new dependency. | `tsc` **0 errors**; **137 pass / 0 fail**; notify suite seen to fail three ways, files restored byte-identical |
| 2026-09-22 | P0.11 audit logging. Added audited insert/update/delete (one transaction each), `record()` takes the transaction, a scan test over `server/modules`. Wrote `PROGRESS.md`. | `tsc` **0 errors**; **144 pass / 0 fail**; audit suite seen to fail three ways, files restored byte-identical |
| 2026-09-22 | P0.14 storage. Fixed the memory adapter storing streamed uploads as zero bytes; keys refuse unsafe segments and traversal; `TenantStorage` scope; SigV4 presigning (`sigv4.ts`, no new dependency); `STORAGE_PROVIDER` + four `R2_*` vars in the env registry, memory refused in production. | `tsc` **0 errors**; **152 pass / 0 fail**; storage suite seen to fail four ways, files restored byte-identical |
| 2026-09-22 | P0.2 finished (`env-example.ts`, generator with `--check`, `.env.example`, `.gitignore` exception) and P0.18 finished (`scope.ts`, `request.ts`, logger + queue + runner carry the scope). | `tsc` **0 errors**; **162 pass / 0 fail**; both seen to fail, files restored byte-identical |
| 2026-09-22 | **P0 gate.** Re-checked every package's "done when". Added the missing tests: roles 403 (P0.10), quota refusal (P0.12), formatters + ar/en parity (P0.15), migration forward/rollback/forward (P0.4), admin-handle allow-list + ESLint rule (P0.5). Fixed: `isWeekend` in UTC, `00966` phones, placeholder RLS rollback (generator now emits real SQL), phone layout at 390 px, store switcher missing on 6 screens (`DataSource.currentTenant`). Added `scripts/verify.mjs`, `docs/gates/P0.md`, P0.19–P0.22. Normalised 49 files to LF (Python text-mode writes had made them CRLF). | `verify.mjs` **passed**: tsc 0 errors, **182 pass / 0 fail**, `.env.example` current, RLS regenerates identically; every new check seen to fail; screenshots RTL + LTR at 1440 and 390 px |
| 2026-09-23 | P0.19 API skeleton: `server/core/http/{api,bootstrap}.ts`, `server/boot.ts`, `server/modules/auth/http.ts`, 9 route files; `revokeByRefreshToken` and `actorOf` in `core/auth/session.ts`. | `verify.mjs` passed: **195 pass / 0 fail**; seen to fail 6 ways, restored byte-identical |
| 2026-09-23 | P0.20 (partly): API client, auth provider, route guard, API data source, Login/Register wired, Sign out, Next shell + catch-all page; `safeNext` moved to `lib/` and now refuses control characters (`/\t/evil.com` → `//evil.com` was an open redirect). | `verify.mjs` passed: **199 pass / 0 fail**; seen to fail 4 ways (3 client + the `?next=` guard); screenshots |
| 2026-09-23 | `audit_logs` made append-only for the app role (`APPEND_ONLY` in db/schema/index.ts → generator grants SELECT, INSERT only; isolation suite expects DELETE refused). Filed item closed. | `verify.mjs` passed: **200 pass / 0 fail**; seen to fail with the old grants (audit test + isolation suite red) |
| 2026-09-23 | Portable Node 22 + pnpm 11.25 → first project install. **First lint run:** 4 errors (2 mine, 2 from P0.17), all real React problems, fixed (`screenFor` returns an element; drawer open-state derived from the path; `useResource` derives `loading`). Full `tsconfig.json` typecheck clean. The real install exposed that tests only worked with the toolkit: `esbuild` added as a devDependency (T10), and `test.mjs` passes bundle files explicitly (Node 22 no longer expands a directory). `verify.mjs` gained a lint step. Dev server: API runs on workerd (boot, request ids, problem+json, logs); protected-route redirect verified in headless Chrome; session providers moved to the layout (one restore per page load) and the shell reads the store from the session (no `/me` call before the guard decides). Session events (login/logout) now audited. | `verify.mjs` on Node 22 with lint: **201 pass / 0 fail, 0 lint errors**; on Node 20 + toolkit: 201 pass, lint skipped (stated) |
| 2026-09-23 | Table cells: the SKU rule `table.data .cell-main span` also matched the `.lines` wrapper and the Team avatar, greying product names; narrowed to `.lines > span`. | preview screenshot |
| 2026-09-23 | Nader's decisions: Postgres on **Hetzner** (T11); **ASCII digits** in Arabic copy (51 characters converted across 11 files, `formatPercent` emits `%`, a scan test guards it); **start account-free P1** under a recorded gate override (T12). | digit scan seen to fail (a `٢٠` put back in plans.ts → red with file:line); preview screenshot |
| 2026-09-23 | **P1 opened (T12).** P1 table with IDs and account needs in PACKAGES. P1.1 onboarding state machine. Route-map guard generalised to every module (`MODULE_HANDLERS`) and to catch a module missing from it. | `verify.mjs` Node 22 + lint: **209 pass / 0 fail**, 0 lint errors; P1.1 and the guard seen to fail 5 ways |
| 2026-09-23 | P1.8 products domain; the route guard reads every method in a route file (`/api/products/[id]` serves three); the dashboard's API source serves the real catalogue. | `verify.mjs` Node 22 + lint: **217 pass / 0 fail**; seen to fail 6 ways |
| 2026-09-23 | **P1.3 connector abstraction** (on the macOS machine, Node 24.9 — baseline 217 pass first). Token vault + connection service; `TenantDb.lockById`; `boundTo` on the AES helpers; first tests for the transport, which found and fixed a POST-retried-after-drop bug. | `verify.mjs` Node 24 + lint: **236 pass / 0 fail**, 0 lint errors; seen to fail 13 ways, restored byte-identical; row lock not provable on PGlite (filed) |
| 2026-09-23 | P1.3 committed on its own (`90d02ce`). **P1.6 sync engine**; scheduler + partitioning split to **P1.6b**. Fixed the plan lookup in entitlements (every subscriber resolved to Starter — found because a 10k sync could not be tested on a 20-product plan). | `verify.mjs` Node 24 + lint: **246 pass / 0 fail**, 0 lint errors; seen to fail 14 ways + the entitlements test red before the fix |
| 2026-09-23 | **P1.7 webhook ingestion** (generic); T13 recorded (forged deliveries not stored); `isUniqueViolation` shared; `TenantDb.tryLockById`; `createSyncIn`/`revokeIn` for in-transaction handlers; worker dispatches webhooks each tick; both new admin-handle files allowed in the test and in ESLint. | `verify.mjs` Node 24 + lint: **253 pass / 0 fail**, 0 lint errors; seen to fail 13 ways |
| 2026-09-24 | Pushed P1.3–P1.7 (`8505c51`). **P1.6b** sync schedule + monthly partitioning (0002). Found and fixed: the isolation walk skipped partitioned tables; a P1.3 transport test counted server arrivals and flaked under load (now counts attempts); my own P1.6 note about `dedupe_key` was wrong (corrected). | `verify.mjs` Node 24 + lint: **262 pass / 0 fail**, 0 lint errors |
| 2026-09-24 | **P1.12 manual 3D upload** (presigned PUT, byte-level GLB/USDZ checks, versioning). A green-under-break exposed a test gap (re-confirming a refused upload) — closed. | `verify.mjs` Node 24 + lint: **268 pass / 0 fail**, 0 lint errors |
| 2026-09-24 | **P1.13 model optimisation** (gltf-transform + meshopt, T14); P1.13b (KTX2, USDZ) split pending a container decision. `pnpm add` stalled on registry timeouts — deps declared by hand at the linked versions. | `verify.mjs` Node 24 + lint: **273 pass / 0 fail**, 0 lint errors |
