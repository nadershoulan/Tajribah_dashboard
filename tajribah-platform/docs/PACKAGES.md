# Work packages

One package ≈ one focused session. **One package per session; never skip a gate.**
A package is done when something was *run* and seen to pass (§13.4).
Mark: `[ ]` todo · `[~]` in progress · `[x]` done + date · `[!]` blocked (say on what).

---

## P0 — Foundation (18)

Nothing user-visible ships. Everything after inherits these decisions.

| ID | Package | Deliverables | Done when |
|---|---|---|---|
| P0.1 ✅ | Repo scaffold | Starter skeleton, folder shape, conventions, docs, state file | `tsc` clean on an empty app |
| P0.2 ✅ | Config & secrets | `server/core/config`: zod env schema, typed loader, `.env.example` **generated** from the registry (§13.6) | Boot fails loudly on a missing var; example file regenerates identically |
| P0.3 ✅ | Error model | RFC 9457 `application/problem+json`, error codes, request ids, a single handler | A thrown domain error becomes the right status + body in a test |
| P0.4 ✅ | Database layer | Drizzle schema (identity, tenancy, billing, catalogue, models, jobs, analytics), uuid v7, money helpers, migration + `-- ROLLBACK:` | Migration applied and reverted once locally |
| P0.5 ✅ | **Tenancy core ⭐** | `TenantContext`, `TenantDb` (predicate injection), `unsafeAdminDb` with lint rule | No path to tenant data exists that does not carry a tenant id |
| P0.6 ✅ | **Isolation suite ⭐** | Schema-walking test: two tenants, every tenant-scoped table, read/write/update/delete denied across | Suite runs and is **seen to fail** when a repository drops its filter |
| P0.7 ✅ | Auth crypto | PBKDF2 hashing with algorithm prefix, HMAC JWT, uuid v7, tokens, keyed HMAC for OTP (§13.6) | Unit tests for verify, tamper, expiry, rehash-on-upgrade |
| P0.8 ✅ | Sessions & auth flows | Login, logout, refresh rotation with reuse detection, password reset, `?next=` allow-list | Reuse of a rotated refresh token revokes the session family, in a test |
| P0.9 ✅ | Notification adapters | Email + SMS behind interfaces; console adapter now, Resend/Unifonic later; Arabic SMS asserted at **70 chars** | Sending in dev prints; the 70-char assertion fails a too-long Arabic template |
| P0.10 ✅ | RBAC | Roles (owner/admin/editor/analyst/viewer), permission list, `requirePermission` | A viewer is denied a write in a test, with 403 not 404 |
| P0.11 ✅ | Audit logging | `audit_logs` writes on every mutating action, actor + changes + request id | An update writes exactly one audit row with a before/after diff |
| P0.12 ✅ | Flags & entitlements | `feature_flags`, plan limits, `assertWithinQuota`, `<PlanGate>` | Exceeding a seeded product quota is refused with the right error |
| P0.13 ✅ | **Job framework ⭐** | `jobs` table, `enqueue/claim/complete/fail`, retries + backoff + dead letter, **≤20% of concurrency per tenant**, a real worker entry point (§13.5) | A flooded tenant does not starve another, in a test |
| P0.14 ✅ | Storage adapter | R2 behind an interface, tenant-scoped keys, presigned uploads, `storage_key` naming | Upload + read back through the adapter locally |
| P0.15 ✅ | i18n core | ar/en catalogues, `dir` handling, SAR / Hijri / `+966` formatters, Arabic-Indic digit folding | A test compares `ar` and `en` key sets and fails on divergence (§13.6) |
| P0.16 ✅ | Design system | Tokens, RTL primitives, dashboard UI kit on shadcn, IBM Plex Sans Arabic | Both mirrors render in a screenshot |
| P0.17 ✅ | Dashboard skeleton | Shell, sidebar, tenant switcher, protected routes, empty/loading/error states | Login → dashboard → logout, rendered |
| P0.18 ✅ | Observability | Request id propagation, structured logging with tenant context, error hook | A request's id appears in every log line it produced |
| P0.19 ✅ | API skeleton | Route handlers through `route()`: auth endpoints (register, login, refresh, logout, verify, reset), session cookie, `requireSession` → `TenantContext`, zod-validated bodies | Each endpoint tested Request → Response, incl. a refused cross-tenant call |
| P0.20 ◐ | Dashboard API client + login + protected routes | An API `DataSource` beside the demo one, login/register screens wired to it, protected routes redirect with `?next=` | Login → dashboard → logout, rendered and tested |
| P0.21 [!] | CI pipeline | Runs `scripts/verify.mjs` + lint on every push | Blocked: no CI runner / repo remote |
| P0.22 [!] | Staging deployment | Worker + Postgres + R2, deployed from CI | Blocked: Cloudflare account, Postgres host |

**P0 gate:** isolation suite green and seen to fail when broken · typecheck + lint clean ·
every check in this table run, not assumed · `STATE.md` honest about what was skipped.
Report: `docs/gates/P0.md`. P0.19–P0.22 are in the plan's P0 (Appendix A) and were missing
from this list until the gate compared the two.

---

## P1 — Core loop (26)

**Open under the T12 gate override: only packages whose "Needs" column is empty.** The rest
wait for their account. A 🔒 package may be *prepared* (interfaces, fakes, fixtures) but is
not marked done until it has run against the real service.

| ID | Package | Needs | Done when |
|---|---|---|---|
| P1.1 ✅ | Onboarding state machine | — | Each step is done because the database says so (connection, dimensions, ready model, widget event), not a stored flag; skipping only where the plan allows |
| P1.2 ✅ | Onboarding UI (wizard, verify email, reset password) | — | The checklist renders from P1.1; each step's action works, in both mirrors. **2FA split to P1.2b** (§14: bigger than one session) |
| P1.2b ✅ | Two-factor sign-in (TOTP) | — (TOTP); SMS 🔒 Unifonic | AUTH-12/14/20–22: enrol with a QR + a code, backup codes shown once, sign-in asks for the code after the password; TOTP secret sealed like store tokens. SMS codes (AUTH-13) wait on Unifonic |
| P1.3 ✅ | **Connector abstraction ⭐** | — | Connection model + encrypted token vault; outbound HTTP with timeout, retry, circuit breaker, per-connection rate limit — each tested against a fake server |
| P1.4 | Salla OAuth | 🔒 Salla Partner | A real Salla store connects and refreshes its token |
| P1.5 | Salla product mapping | 🔒 Salla Partner | Real Salla payloads map to products, incl. Arabic names and variants |
| P1.6 ✅ | **Sync engine ⭐** | — (fake connector) | Full + incremental sync of 10k products, resumable, idempotent, progress readable, against a fake connector |
| P1.6b ✅ | Sync schedule + item partitioning | — | Split from P1.6 (§13 step 2). One scheduler tick reads the database (§13.6): due connections get an incremental sync; `queued`/`running` syncs with no progress for N minutes are re-enqueued (closes the enqueue-after-commit gap). `sync_job_items` partitioned by month (§7.11) with migration + `-- ROLLBACK:`, partitions covered by RLS and the isolation walk |
| P1.7 ✅ | Webhook ingestion | — (generic); Salla signature 🔒 | Dedup constraint, raw-body signature check, stored-then-handled, replay; seen to refuse a forged and a duplicate delivery |
| P1.8 ✅ | Products domain | — | Schema contract, repository/service/handlers; every mutation audited; quota enforced |
| P1.9 ✅ | Products list UI | — | Renders from the API, search/filter/paging, both mirrors, 390 px |
| P1.10 ✅ | Product detail UI | — | Dimensions editable in mm, AR toggle, model link |
| P1.11 ✅ | Connections UI | — (UI); connect button 🔒 | Status, last sync, errors, disconnect |
| P1.12 ✅ | Manual 3D upload | — (memory storage); real R2 🔒 | Presigned upload, format validation (GLB magic bytes, size), versioning |
| P1.13 ✅ | Model processing pipeline | — | Optimise (prune, dedup, weld, meshopt) as an `ai.postprocess` job; < 2 MB target reported. KTX2 and GLB→USDZ split to P1.13b |
| P1.13b | Textures + USDZ | ❓ worker container decision | KTX2/Basis textures and GLB→USDZ need native encoders (`toktx`; Blender or `usd-core`) in the worker image — choose the image first |
| P1.14 ✅ | Model library UI | — | Versions, status, publish |
| P1.15 ◐ | **Edge viewer config ⭐⭐** | 🔒 Cloudflare KV (code done 2026-09-29) | Publish writes a versioned entry behind `ConfigStore` (KV in production); the shopper path never reads Postgres. Built: builder checked by the widget's parser, publisher, keep-true refreshes, config host. The `cfg.` Worker has its deploy config (`wrangler.config-host.jsonc`) and was run in workerd over a local KV (2026-09-29). Left: create the KV namespace (put its id in that file and bind it as `CONFIGS` to the dashboard Worker), route `cfg.tajribah.com/v1/*`, a live check |
| P1.16 ✅ | **AR viewer widget ⭐⭐** | — | < 60 KB gzipped, loads after the page, fails closed |
| P1.17 ✅ | Embed & install | — | Snippet + install checker |
| P1.18 ✅ | Shopper AR experience | — | WebXR / Quick Look / Scene Viewer paths |
| P1.19 | Hosted AR pages | 🔒 domain | Per-product page on the short domain |
| P1.20 | QR codes | 🔒 short domain (§12 #3) | Per product, printable. **Blocked:** a printed code is permanent, so it must encode the final short domain — codes printed against a temporary host break when the domain arrives |
| P1.21 ✅ | AR settings UI | — | Button style, placement, per product |
| P1.22 ✅ | Dashboard home | — | Renders from the API (currently seeded) |
| P1.23 ✅ | Dashboard shell extras | — | Command palette, notification centre |
| P1.24 ✅ | Team management | — | Invite (email), roles, remove — audited |
| P1.25 ✅ | Settings | — | Store details, CR/VAT, branding |
| P1.26 | Core-loop E2E + viewer load test | 🔒 all of the above live | A real merchant completes the loop unaided; viewer at 5k rps |

**Gate:** a real merchant completes signup → connect → sync → AR live, unaided.

## P2 — Billing (15)

**Open under T18: only packages whose "Needs" column is empty.** Moyasar (payments) and the
ZATCA provider block the rest; they may be prepared against fakes, not marked done.

| ID | Package | Needs | Done when |
|---|---|---|---|
| P2.1 ✅ | Plans & entitlements | — | Plans, limits and features are rows, seeded by a migration from `lib/plans.ts` and checked equal to it by a test; every quota and feature gate reads the rows (a limit changed in the database takes effect without a deploy); Track A can build on it |
| P2.2 ✅ | Usage metering | — | Every metered number has one source, idempotent by construction: live counts (products, team, **storage = bytes held**), AR sessions from the rollup's days in the Riyadh month, bandwidth as per-day totals that are *set* (a replay or concurrent report writes one number); storage checked before an upload; the home screen shows the quota's own figures. AI credits move to the ledger in P2.9 |
| P2.3 | Payment provider adapter | 🔒 Moyasar | Charge, refund, 3-D Secure redirect against Moyasar's sandbox; a fake for tests |
| P2.4 | **Subscription lifecycle ⭐** | 🔒 Moyasar | (T44: every plan move must call `enqueueEdgeRefresh(tenantId)` — a published config's "on me" follows the plan.) Trial → active → past_due → cancelled/expired, upgrades/downgrades with proration, every move in `subscription_changes` |
| P2.5 | **Payment webhooks ⭐** | 🔒 Moyasar | `billing_events` insert first; a duplicate delivery changes nothing — the gate's duplicate-webhook test |
| P2.6 ✅ | Invoices & VAT | — | Gapless invoice numbers per store per year (allocated in the invoice transaction), VAT 15 % shown separately, bilingual invoice document; ZATCA fields left for P2.7 |
| P2.7 | ZATCA e-invoicing | 🔒 ZATCA provider + CSID | Invoices reported/cleared through a certified provider, QR on the document |
| P2.8 | Dunning | 🔒 Moyasar | Failed renewals retried on a schedule, merchant told, store read-only only after the grace period |
| P2.9 ✅ | AI credits ledger | — | Append-only `credit_ledger`; balance = sum of deltas; plan grants per period, consumption refused below zero; a dispute answerable by replay |
| P2.10 ◐ | Billing UI | — (UI); pay button 🔒 | Plan, usage, invoices and credits from the API; choose-plan flow up to the payment step |
| P2.11 ✅ | Trial lifecycle | — | Trial reminders before the end; a lapsed trial is read-only everywhere writes happen (not only where remembered), with the reason shown |
| P2.12 ◐ | Coupons | — (model); redemption at checkout 🔒 | Percent / fixed / free-months coupons with limits and expiry; validated server-side |
| P2.13 ✅ | Billing notifications | — (email); SMS 🔒 | Trial ending, payment failed, invoice issued — bilingual, once each |
| P2.14 | Financial reporting | 🔒 real payments | MRR, churn, revenue by plan — from invoices and payments |
| P2.15 | Billing integrity tests | 🔒 Moyasar | The gate: full payment cycle incl. failure, refund and duplicate webhook |

## Track A — Admin console (14)

**Open under T18 (after P2.1).** Lives in this app at `/admin` (docs/ARCHITECTURE.md), staff
only. Screen IDs from the inventory (`ADM-*`).

| ID | Package | Needs | Done when |
|---|---|---|---|
| A1 ✅ | Admin app & access control | — | Only staff **with two-step sign-in** reach any admin endpoint or screen (others: 404, so the console is not even revealed); every staff action lands in a platform staff audit trail the app role cannot read or write; the console looks unmistakably different |
| A2 ✅ | Platform overview | — (numbers); real revenue 🔒 | ADM-02: stores by status, trials ending, MRR/ARR from subscriptions × the plan rows, new stores — from the database |
| A3 ✅ | Tenant management | — | ADM-03…07: every store, filterable; one store's profile, usage, billing and connections |
| A4 ✅ | Tenant actions | — | ADM-08: suspend/restore, extend a trial, credit adjustment — each with a reason, in both the store's and the staff trail |
| A4b ✅ | Impersonation (split from A4) | A4 | ADM-08: view the dashboard as the store — read-only, time-limited, shown to staff by a banner and to the store in its activity |
| A5 ✅ | User management | — | ADM-11/12: find a person, their stores; end their sessions, reset their two-step sign-in — audited |
| A6 ✅ | Plans & pricing management | — | ADM-13/14: edit a plan's prices, limits and features (T19: applies to everyone), audited |
| A7 ◐ | Subscriptions & invoices | — (view); refunds 🔒 | ADM-17…19: subscriptions and invoices across stores |
| A8 | Payments & revenue | 🔒 Moyasar | Payments, refunds, revenue |
| A9 ✅ | AI operations | — | `/admin/ai`: jobs by type and outcome, provider cost beside credits (net of refunds), failures with the provider's text, quiet jobs with a staff cancel, top stores by cost. No margin until a credit has a price |
| A10 ✅ | Content & QA queues | P3.6 | Model QA review — `/admin/qa`: a 3D viewer, measurements against the product, approve / send back with a note; T25 gate on publishing |
| A11 ✅ | Platform operations | — | Queue health, stuck jobs, webhook failures, key rotation state |
| A12 ✅ | Support tooling | — | Look up a store/person/request id and see what happened |
| A13 ✅ | Content management | — | Coupons (ADM-15) and platform copy — **announcements** (T23) |
| A14 ✅ | Compliance & system | — (rules: T22, working rules until counsel reviews) | Data requests, retention, the staff trail (A1, ADM-43) |

## P4 — Analytics (12)

**Open under T18.** D5's *rule* holds — analytics never touches the merchant's transactional
read path — but this build keeps it in Postgres rather than ClickHouse: `analytics_events`
plus four rollup tables, already in `db/schema/analytics.ts` and recorded in
`docs/ARCHITECTURE.md`. The event schema stays ClickHouse-shaped, so that move is an exporter,
not a rewrite. **Almost all of P4 is therefore account-free**; the corrected table is below.
(An earlier version of this table marked P4.3 onwards 🔒 ClickHouse. That was wrong — written
from the plan rather than from the schema that exists.)

**Split (2026-09-27, Nader):** two sessions. The **write** side — P4.1, P4.2, P4.3, P4.9,
P4.10, P4.11 — and the **read** side — P4.4, P4.5, P4.6, P4.8. The four rollup tables are the
contract between them and neither side changes their columns without telling the other. Files
are split too: writer in `server/modules/analytics/{ingest,rollup}.ts` and
`app/api/analytics/collect`, reader in `server/modules/analytics/{metrics,http}.ts` and
`app/api/analytics/route.ts`.

Two reading rules the write side must honour, agreed across the split:
store totals come from `daily_tenant_stats` and the per-product table from
`daily_product_stats`, and the two are **not** required to agree (an event whose product
reference does not resolve is counted for the store and dropped for the product); and uplift on
the wire is a **fraction** (0.051 = 5.1 points), **null** unless both sides have at least 100
sessions — so `conversion_daily` must carry the session counts that let the reader decide that,
not a pre-computed rate.

| ID | Package | Needs | Done when |
|---|---|---|---|
| P4.1 ✅ | Event schema & browser SDK | — (write side) | `widget/src/events.ts` (the wire contract, no dependencies, ships in the widget) and `lib/contracts/analytics.ts` (the same constants under zod, for the collector). The SDK batches, sends with `sendBeacon` and leaves with the page; it sends **nothing** under DNT/GPC or before a shop's consent, and nothing that identifies a shopper — unknown fields, over-long values and property values that look like a person are dropped before the queue |
| P4.2 | Event collector | — | `POST /api/analytics/collect`. **The body arrives as `text/plain`** (P4.1's `BODY_TYPE`: a JSON content type would need a preflight `sendBeacon` cannot perform), so it is parsed as JSON and `Content-Type` is never read as a claim. It is a public, unauthenticated endpoint by nature — nothing in a widget can keep a secret — and is defended accordingly, in this order (agreed with the P7 session): **cap the body before reading it** (Content-Length, then stop at the cap while streaming, as `webhooks` does with `MAX_WEBHOOK_BYTES`); **resolve the store key first** and drop an unknown one with no work done, never echoing the body into an error; **rate-limit per store key and per hashed IP** (salted daily like the session token) through `rateLimiter()`, dropping silently with 204 over the limit, since the client never retries; treat **Origin/Referer as a soft signal** — tag events whose origin does not match the store's connected domain so rollups can discount them, but never reject on it (a missing Origin is normal); and **distrust every field** — server clock, server-resolved product uuid, enum and length caps from the zod contract |

**P4.2's rate limits** (with the P7 session; starting numbers for P7.1's load tests to tune,
not gospel). One tab sends at most ~5 batches a minute — `LIMITS.flushMs` plus one on
pagehide — each capped at 20 events:

| Scope | Limit | Why |
|---|---|---|
| store key + daily-salted IP hash | 60 batches/min | ~12 active tabs behind one address. Keyed **per store, not per IP globally**: Saudi carriers put many shoppers behind one address (CGNAT), so a global IP limit would lock out a whole carrier, while this still caps one script hammering one shop |
| store key | 1,200 batches/min (~24k events/min) | Far above any plan's real traffic, so it trips on a flood and never on a sale day. Log when it trips — staff should see it |
| batch | 20 events, **16 KB** | Matches the SDK's own `LIMITS.batch` and `LIMITS.bodyBytes`. Refuse anything larger whole, before parsing. (16 KB, not the browser's 64 KB beacon ceiling: the SDK refuses to send more than 16 KB, so accepting four times that would only widen what we accept from anyone else) |
| over a limit | 204, dropped silently, counted | Never 429: the SDK never retries, so a 429 would only tell whoever is probing where the line is |

Window: fixed 60 seconds through `rateLimiter()`, so it moves to KV with the rest (the
in-memory limiter is per isolate until P1.15).

| P4.3 | Rollups & retention | — | The four rollup tables filled from `analytics_events` on a schedule, idempotently (a re-run must not double-count), and raw events expiring at 90 days |
| P4.4 ✅ | Metrics API | — (read side) | The dashboard's read path — rollup tables only, never `analytics_events`; uplift as a fraction, null below 100 sessions a side. Built by the read-side session, on main at a45e85a |
| P4.5 ✅ | Analytics UI | — (read side) | MD-120 on real numbers: uplift in **percentage points with its sign** (`formatPoints`; it read "+5.1%" and could not show a worse result), empty uplift / return figures say why, "Tracked revenue" (was "Attributed", an overclaim), device bars scaled to the largest bucket, a no-data note for a new store; the home screen's uplift uses the same rule. Built by the read-side session (52f7fd5) |
| P4.6 ✅ | Conversion uplift ⭐ | — (read side) | Both groups with their sessions and purchase rates, the difference in points, **whether it could be chance** (two-proportion z-test at 95%, drops included), and the self-selection caveat — on the screen and in `AnalyticsView.conversion`. Built by the read-side session |
| P4.7 | Return-rate reporting | 🔒 Salla/Zid | Genuinely blocked: returns come from the store platform, and no connector is live |
| P4.8 ◐ | Exports & scheduled reports | email sending (read side) | **CSV built** (API-121 `GET /api/analytics/export`: one row per Riyadh day, empty days zero, riyals to two decimals, `analytics:export` only — viewers get the button disabled with the reason). The scheduled email waits on live sending |
| P4.9 | Real-time activity | P4.2 (write side) | What is happening now, read from the raw events rather than the rollups |
| P4.10 | Session explorer | P4.2 (write side) | One session's path, within the 90 days it exists for |
| P4.11 | Analytics privacy & PDPL | — (write side) | The collection half is P4.1; what is left is retention (the 90 days, enforced by the A14 sweep), who may read it, and the PDPL register's answer for analytics |
| P4.12 | Analytics load test | 🔒 staging | The plan's 2.5M events/day end to end — and the number at which Postgres stops being the right answer |

## Track M — Marketing site (12)

**Not in this app.** The marketing site is Nader's `../tajribah-try-on` (Arabic-first, and it
carries the live try-on demo). Its own rules apply — that repo's `CLAUDE.md`: improve in
place, never rewrite the studio, real photography only, invent nothing. Most of the plan's
Track M pages existed there before the track opened, so a package here usually means
*finish what the page still lacks*, not *build a page*.

| ID | Package | Needs | Done when |
|---|---|---|---|
| M1 ◐ | Site scaffold | analytics choice 🔒 domain | Next app, Arabic-first i18n with an RTL layout, tokens, per-page SEO titles — **built**; the consent banner and the analytics gate behind it are **not** (no analytics vendor chosen), and deployment waits on Cloudflare and the domain |
| M2 ✅ | Home & core pages | — | Home, features, how it works, integrations, demo, about, contact, FAQ — on the real studio and real photography |
| M3 ✅ | Pricing | — | Plan cards, feature matrix, add-ons; **monthly / annual switch** on the dashboard's own catalogue figures (a year = ten months, stated as such); **a pays-for-itself calculator** on the merchant's numbers and the merchant's own assumptions — no uplift figure of ours anywhere in it |
| M4 ✅ | Salla & Zid landing pages | — | `/salla`, `/zid`: the platform named, no logo, its figures not repeated, a trademark note, availability stated as on the integrations page |
| M5 ✅ | Product feature pages | — | `/features/{on-model,on-me,true-size,phone-handoff}`: a page per **way to try**, each with what the shopper does, how it works underneath, what the merchant sets up, **what it does not do**, and questions. AR viewing and AI try-on get pages when they exist — P1.15–P1.20 and P5 |
| M6 ✅ | Industry solution pages | — | `/industries` + `/industries/{watches,jewellery,eyewear,bags}` (`content/industries.ts`): the size question in each category, **each way to try tagged *available today* or *not built yet*** following the feature pages (watches: all four; jewellery: bracelets on the wrist, any piece at true size, neck and ear not built; eyewear: frame width at true size, face not built; bags: small bags beside an iPhone, on-body not built), what to measure, questions |
| M7 ✅ | Blog | — | `/blog` + 6 posts, no invented statistics |
| M8 ✅ | Help centre | — | `/help` + 15 articles written against the dashboard as it is built |
| M9 ◐ | Trust & social proof | 🔒 real customers | `/customers` exists with 3 stories **labelled illustrative**; real logos, quotes or figures need real customers who agree in writing (§11 and Saudi e-commerce rules — inventing them is not an option) |
| M10 ✅ | Company & careers | — | `/about`, `/careers` (roles we expect to open; no advertised vacancy), SRO Company's legal details in the footer |
| M11 ✅ | Legal pages | counsel review | Privacy, terms, refund, cookies, try-on privacy — drafts, and the in-file note saying they await Saudi-licensed counsel stays |
| M12 ◐ | SEO & conversion optimization | domain 🔒 | **Built:** `app/sitemap.ts` (every titled page, help article and blog post, with dates), `app/robots.ts` (crawl the site, not `/api/` or `/capture/`), `metadataBase` from `NEXT_PUBLIC_SITE_URL` (default the placeholder domain; `typeof process` guard for the static preview), Organization JSON-LD (SRO Company, VAT, Riyadh 13524) and BlogPosting JSON-LD per post. **Also built:** per-page canonical and share card (`lib/seo.ts` `pageMeta`, relative paths against `metadataBase`, so they follow the domain when it is set; the share image is repeated per page because a page's `openGraph` replaces the layout's). **Open:** the final domain itself, and the conversion pass over the funnel. One URL serves both languages (cookie), so there are no hreflang alternates to add |

**Filed against Track M (from A6):** the site's plan prices live in
`tajribah-try-on/lib/plans.ts` and are kept equal to this app's catalogue by hand. Staff can
change a price in ADM-13 and the site would not follow. Closing it needs a public prices
endpoint the site reads at build time — which needs the API deployed (P0.22).

## P3–P8 and the parallel tracks

As in the plan's Appendix A, unchanged: P3 3D pipeline (12) ·
P5 Try-on (14) · P6 AI + connectors (16) · P7 Scale (13) ·
P8 Enterprise (12) · Track A Admin (15). Track M has its own table above.

**P3.2 AI job orchestration ⭐** (2026-09-27, T18) — `server/modules/ai-jobs/`: the lifecycle (conditional transitions, charged once and refunded once through the credits ledger, immediate cancel — credits back only before it starts, T24), progress for the UI, a sweep for undispatched and abandoned jobs, API-140/141/142. Done when: a job cannot finish twice, be run after a cancel, be charged twice or refunded twice, refunded after the provider started, and a dead worker cannot leave one running — each seen to fail. Creating a job over HTTP arrives with the generation screen (P3.7); the first executor with the adapter (P3.4, needs a provider).

**P3.3 photo intake & quality checks** (2026-09-27) — `generation_photos` (0016), presigned upload then a check of the bytes themselves: format, header dimensions, size, aspect, duplicates; refused bytes deleted at once; one photo per angle; counted in storage; a 24 h sweep for uploads never confirmed; API-143–146. Pixel checks (blur, exposure, background) are the AI service's (P3.1). Done when: every format's header read from real photos, and each rule seen to fail.

**P3.5 ✅ post-processing ⭐** (2026-09-28) — `postprocess.ts`: WebP textures at the largest step under 2 MB, simplification over 100k triangles, JPEG/PNG for the native file, generated models fitted to the product and floored, disagreements to `qa_notes`. Done when: a real textured model goes under 2 MB and renders the same — 8.97 MB → 509 KB, rendered side by side. Also fixed the widget's missing meshopt decoder. USDZ conversion remains P1.13b.

**P3.6 ✅ model review** (2026-09-28, with A10; T25) — generated models reviewed by staff before they can go live; uploads never held; decisions recorded twice and told to the merchant.

**P3.8 ◐ 3D editor** (2026-09-28) — turn in 90° steps with a preview that matches the saved file, real size before and after, fit to the product; saved as a new version through the upload path. Left: the model-list picture (needs the CDN); hotspots and the first camera view belong with the AR settings.

**P3.7 ◐ generation UI** (2026-09-28) — the photo part is built: `components/pages/ProductPhotos.tsx` on the product page, the three `DataSource` calls, the preview running the real check in the browser. Left for when P3.4 exists: the Generate action (needs the credits per generation from Nader), and job progress with cancel (API-140–142 are ready for it).

**P7.7 security hardening ◐** (2026-09-27) — code-level, so not held by P7's "do not start early". Done: security headers on every response (`server/core/http/security-headers.ts`, `next.config.ts`); `/api/auth/refresh` limited per session (§13.6). Audited sound: auth limits and lockout, webhook signatures, install-check SSRF rules, upload sizes, CSRF surface, no-store, error bodies. Then the full page CSP: `proxy.ts`, a nonce per page, no inline or eval for scripts, checked in a real browser on a production build. **DNS rebinding on the install checker** (T45, 2026-09-29): every hop's host is resolved over DNS-over-HTTPS first and a name pointing at a private or reserved address (v4 and v6, incl. link-local metadata and mapped v4) is refused; a failed lookup refuses. Residual: rebinding *between* that lookup and the fetch — a Worker cannot reach private networks, so accepted. Open: `form-action` re-check with the P3 checkout; an independent review for the P7 gate.

**Track P5 note:** the try-on engine already exists and is proven in
`../tajribah-try-on`. It is lifted, not rewritten — see that repo's `CLAUDE.md`.

**P5 (T26: watches first, the studio unchanged)** — **P5.1 ✅ engine core** (2026-09-28): the studio takes an optional `product` (demo byte-identical); `/embed/try-on` loads a merchant's watch from the config host; the widget opens it in a frame for wrist products with a `tryon` block. **P5.3 ◐ watches**: model-mode size done (Nader's yes); publishing to the shop built (P1.15, 2026-09-29) and seen end to end in a real browser (a watch with try-on and no 3D model included); the live check waits on Cloudflare. **P5.10 ✅ try-on settings** (2026-09-28): `/dashboard/tryon`, 0017, cut-outs checked for transparency by header, case width, finish, on/off; every plan since T33 ("on me" is Pro). **P5.7 ✅ consent & privacy** (2026-09-28, T27): the embed's notice + privacy link, a browser proof that an "On me" photo is never sent, and a per-minute sweep of expired QR sessions (`lib/pair-sweep.ts`, `worker/index.ts`); cron unverified until Cloudflare. **P5.14 ✅ marketing pages** (2026-09-28): help article `watch-tryon-setup`; the mode pages existed (M5). **P5.12 ✅ performance** (2026-09-28): config read at the edge + the studio's images preloaded (`lib/tryon-config.ts`, `app/embed/try-on/page.tsx`), cut-outs as lossless WebP + immutable, widget preconnect; studio ready 5.4 → 2.8 s (slow), 1.9 → 0.9 s (fast), measured on the production build; the blank-frame header bug (vinext first-match-wins) and the unprotected home page fixed. **P5.9 ✅ quality scoring** (2026-09-28, T28): `tryon.quality` job — empty edges cropped (lossless), share of real size measured, `quality` jsonb (0018) + `quality_score`; warns, never blocks. **P5.13 ✅ try-on analytics** (2026-09-28): last 30 days per watch on `/dashboard/tryon` (analytics:read only) and a Try-ons column in top products, from `daily_product_stats`. Glasses follow watches.

**P6 (started 2026-09-28)** — **P6.8 ✅ AI jobs UI** (2026-09-29): `/dashboard/ai-jobs` (`components/pages/AiJobs.tsx`) over API-140 (list) and API-142 (cancel) — progress and stage, credits cost and refund, cancel with the T24 refund rule stated, product named via `AiJobView.product`. **P6.9 ✅ connector conformance suite ⭐** (2026-09-28): `server/connectors/conformance.ts` — a store double per connector, a shared 250-product catalogue, 12 checks from what the sync engine relies on, `describeConformance()`; proven on the reference store and 15 mistaken connectors. Every connector (Salla onwards) registers it in its own test file.
**P6.16 ✅ connection health** (2026-09-28): `lib/connection-health.ts` (the rule), `server/modules/connections/health.ts` (facts, live health, the per-tick sweep with worsening notifications); shown on the connections screen.

**Note for the owner of P4.2 / P4.3 (the rollup writer)** — P5.13 (2026-09-28) reads `daily_product_stats.tryon_sessions` per product per Riyadh day (the agreed read contract): the try-on screen's "last 30 days" and the Try-ons column in top products stay at zero until the rollup fills that column from `tryon_start` events.
**P7 (code-level only)** — **zero-downtime migrations ◐** (2026-09-28): `server/testing/migration-safety.ts` + `db/__tests__/migration-safety.test.ts` — expand-only unless a `-- contract:` reason, no NOT NULL without DEFAULT, no locking index/constraint on an existing table without CONCURRENTLY/NOT VALID or `-- lock-ok:`. The runner (CONCURRENTLY outside a transaction, deploy order) waits on the database host.
