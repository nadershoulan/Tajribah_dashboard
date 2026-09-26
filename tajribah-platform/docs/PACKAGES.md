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
| P1.15 | **Edge viewer config ⭐⭐** | 🔒 Cloudflare KV | Publish writes a versioned KV entry; the shopper path never reads Postgres |
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
| P2.4 | **Subscription lifecycle ⭐** | 🔒 Moyasar | Trial → active → past_due → cancelled/expired, upgrades/downgrades with proration, every move in `subscription_changes` |
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
| A4b | Impersonation (split from A4) | A4 | ADM-08: view the dashboard as the store — read-only, time-limited, shown to staff by a banner and to the store in its activity |
| A5 ✅ | User management | — | ADM-11/12: find a person, their stores; end their sessions, reset their two-step sign-in — audited |
| A6 ✅ | Plans & pricing management | — | ADM-13/14: edit a plan's prices, limits and features (T19: applies to everyone), audited |
| A7 | Subscriptions & invoices | — (view); refunds 🔒 | ADM-17…19: subscriptions and invoices across stores |
| A8 | Payments & revenue | 🔒 Moyasar | Payments, refunds, revenue |
| A9 | AI operations | 🔒 P3 | AI jobs, cost, failures |
| A10 | Content & QA queues | 🔒 P3 | Model QA review |
| A11 | Platform operations | — | Queue health, stuck jobs, webhook failures, key rotation state |
| A12 | Support tooling | — | Look up a store/person/request id and see what happened |
| A13 | Content management | — | Coupons (ADM-15) and platform copy |
| A14 | Compliance & system | — (view); PDPL process ❓ | Data requests, retention, the staff trail |

## P3–P8 and the parallel tracks

As in the plan's Appendix A, unchanged: P3 3D pipeline (12) ·
P4 Analytics (12) · P5 Try-on (14) · P6 AI + connectors (16) · P7 Scale (13) ·
P8 Enterprise (12) · Track M Marketing (12) · Track A Admin (15).

**Track P5 note:** the try-on engine already exists and is proven in
`../tajribah-try-on`. It is lifted, not rewritten — see that repo's `CLAUDE.md`.
