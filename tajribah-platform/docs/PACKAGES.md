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
| P1.2 | Onboarding UI (wizard, verify email, reset password, 2FA) | — | The checklist renders from P1.1; each step's action works, in both mirrors |
| P1.3 ✅ | **Connector abstraction ⭐** | — | Connection model + encrypted token vault; outbound HTTP with timeout, retry, circuit breaker, per-connection rate limit — each tested against a fake server |
| P1.4 | Salla OAuth | 🔒 Salla Partner | A real Salla store connects and refreshes its token |
| P1.5 | Salla product mapping | 🔒 Salla Partner | Real Salla payloads map to products, incl. Arabic names and variants |
| P1.6 ✅ | **Sync engine ⭐** | — (fake connector) | Full + incremental sync of 10k products, resumable, idempotent, progress readable, against a fake connector |
| P1.6b ✅ | Sync schedule + item partitioning | — | Split from P1.6 (§13 step 2). One scheduler tick reads the database (§13.6): due connections get an incremental sync; `queued`/`running` syncs with no progress for N minutes are re-enqueued (closes the enqueue-after-commit gap). `sync_job_items` partitioned by month (§7.11) with migration + `-- ROLLBACK:`, partitions covered by RLS and the isolation walk |
| P1.7 ✅ | Webhook ingestion | — (generic); Salla signature 🔒 | Dedup constraint, raw-body signature check, stored-then-handled, replay; seen to refuse a forged and a duplicate delivery |
| P1.8 ✅ | Products domain | — | Schema contract, repository/service/handlers; every mutation audited; quota enforced |
| P1.9 ✅ | Products list UI | — | Renders from the API, search/filter/paging, both mirrors, 390 px |
| P1.10 | Product detail UI | — | Dimensions editable in mm, AR toggle, model link |
| P1.11 | Connections UI | — (UI); connect button 🔒 | Status, last sync, errors, disconnect |
| P1.12 ✅ | Manual 3D upload | — (memory storage); real R2 🔒 | Presigned upload, format validation (GLB magic bytes, size), versioning |
| P1.13 ✅ | Model processing pipeline | — | Optimise (prune, dedup, weld, meshopt) as an `ai.postprocess` job; < 2 MB target reported. KTX2 and GLB→USDZ split to P1.13b |
| P1.13b | Textures + USDZ | ❓ worker container decision | KTX2/Basis textures and GLB→USDZ need native encoders (`toktx`; Blender or `usd-core`) in the worker image — choose the image first |
| P1.14 | Model library UI | — | Versions, status, publish |
| P1.15 | **Edge viewer config ⭐⭐** | 🔒 Cloudflare KV | Publish writes a versioned KV entry; the shopper path never reads Postgres |
| P1.16 | **AR viewer widget ⭐⭐** | — | < 60 KB gzipped, loads after the page, fails closed |
| P1.17 | Embed & install | — | Snippet + install checker |
| P1.18 | Shopper AR experience | — | WebXR / Quick Look / Scene Viewer paths |
| P1.19 | Hosted AR pages | 🔒 domain | Per-product page on the short domain |
| P1.20 | QR codes | — | Per product, printable |
| P1.21 | AR settings UI | — | Button style, placement, per product |
| P1.22 | Dashboard home | — | Renders from the API (currently seeded) |
| P1.23 | Dashboard shell extras | — | Command palette, notification centre |
| P1.24 | Team management | — | Invite (email), roles, remove — audited |
| P1.25 | Settings | — | Store details, CR/VAT, branding |
| P1.26 | Core-loop E2E + viewer load test | 🔒 all of the above live | A real merchant completes the loop unaided; viewer at 5k rps |

**Gate:** a real merchant completes signup → connect → sync → AR live, unaided.

## P2–P8 and the parallel tracks

As in the plan's Appendix A, unchanged: P2 Billing (15) · P3 3D pipeline (12) ·
P4 Analytics (12) · P5 Try-on (14) · P6 AI + connectors (16) · P7 Scale (13) ·
P8 Enterprise (12) · Track M Marketing (12) · Track A Admin (14).

**Track P5 note:** the try-on engine already exists and is proven in
`../tajribah-try-on`. It is lifted, not rewritten — see that repo's `CLAUDE.md`.
