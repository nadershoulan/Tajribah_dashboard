# Tajribah — Build Plan & Technical Handoff

**A multi-tenant AR/AI commerce SaaS for Saudi e-commerce merchants.**

> **Who this is for:** an engineer or team starting this product from scratch, on a clean
> repository. It is the complete specification of what was being built, why each decision
> was made, what order to build it in, and — most importantly — which traps cost the first
> attempt the most time.
>
> **Status of the first attempt:** ~103 of 231 work packages built over roughly one month.
> Foundation, auth, tenancy/RLS, connectors, catalogue, the 3D upload + optimization
> pipeline and most of the dashboard exist and are tested. It stalled not on engineering
> but on **external accounts** (Salla partner, payment merchant, domain, Cloudflare
> Workers). See §12 and §13 — they are the difference between repeating that and not.

---

## 0. How to read this

| If you are… | Read |
|---|---|
| Deciding whether to take the project | §1, §2, §4, §13, §16 |
| Writing the first line of code | §4 → §5 → §6 → §7 → §9, then §13 in full |
| Planning the schedule | §9, §12, §16 |
| Designing screens | §10, §11 |

**§13 is the highest-value section in this document.** It is a list of bugs, dead ends and
wrong turns that have already been paid for once. Each one is a day or more.

---

## 1. What Tajribah is

**"The Shopify of AR commerce for Saudi Arabia."**

**The name.** Tajribah — **تجربة** — is Arabic for *experience*, and also for *trying
something on*. Use the Arabic spelling as the primary wordmark; the product is Arabic-first
(§11) and the name reads natively in the market it sells to. Latin transliteration
`Tajribah` is the secondary form, used for domains, package scopes (`@tajribah/*`),
database roles (`tajribah_app`, `tajribah_admin`) and code identifiers. Keep one
transliteration everywhere — `tajriba`, `tajreba` and `tajribah` are all plausible and
picking two of them is how you end up with a package scope that does not match the domain.

A self-service SaaS platform where an e-commerce merchant can:

1. Register and pick a plan
2. Connect their store (Salla, Zid, Shopify, WooCommerce)
3. Import their product catalogue automatically
4. Get 3D/AR models — uploaded, AI-generated from photos, or ordered as a service
5. Turn on "View in AR" and virtual try-on inside their own storefront
6. See the conversion and return-rate impact, and pay monthly

**It is explicitly not** a custom AR project delivered per client. Every capability is
multi-tenant from the first table. Building a single-store solution and "making it
multi-tenant later" is the failure mode this architecture exists to avoid.

### The product surface, in four layers

```
┌──────────────────────────────────────────────┐
│  Super Admin console   (internal operations) │
├──────────────────────────────────────────────┤
│  Tenant layer — Store A │ Store B │ Store C  │
├──────────────────────────────────────────────┤
│  Shared services                             │
│  auth · billing · AI engine · AR engine ·    │
│  analytics · notifications                   │
├──────────────────────────────────────────────┤
│  Salla · Zid · Shopify · WooCommerce APIs    │
└──────────────────────────────────────────────┘
```

### Modules

| # | Module | What it does |
|---|---|---|
| 1 | **Merchant management** | Register, verify, select plan, pay, invite team |
| 2 | **Store integration engine** | OAuth connect, product/stock/order sync, webhooks |
| 3 | **AI 3D generator** | Merchant uploads front/side/back photos → GLB + USDZ |
| 4 | **AR viewer** | Shopper taps "View in AR" — WebXR, no app install |
| 5 | **AI virtual try-on** | Glasses → watches → rings → necklaces → bags → fashion |
| 6 | **Analytics** | Views, AR sessions, try-ons, conversion uplift, return reduction |
| 7 | **Billing** | Plans, subscriptions, ZATCA invoices, AI credits, quotas |
| 8 | **Admin console** | Tenant ops, support, AI cost/margin, QA queues |

---

## 2. Business model

### Plans

| Plan | Price | Includes |
|---|---|---|
| **Starter** | 99 SAR/mo | 20 products, basic AR |
| **Growth** | 299 SAR/mo | 200 products, AI comparison |
| **Pro** | 999 SAR/mo | Unlimited products, AI try-on, analytics |
| **Enterprise** | Custom | White label, API access, SSO, dedicated support |

### Revenue streams

- Monthly SaaS subscription (99–999 SAR) — the core
- AI credits, sold per generation
- Professional 3D modelling, per product
- White label (10k+ SAR/month)
- Enterprise API, usage-based
- Marketplace commission (future phase)

### The unit economics that must hold

At 500 merchants averaging 299 SAR (~$80), revenue is ~$40,000/month against
**~$1,650/month of infrastructure**. That margin exists because of two decisions in §4
(zero-egress object storage and client-side try-on inference). If either is reversed, the
infrastructure bill roughly triples and the AI cost line becomes unbounded. Protect them.

---

## 3. The two journeys

### Merchant journey — authenticated, heavy, low volume

```
Register → verify email → pick plan → pay → connect Salla (OAuth)
   → catalogue syncs → pick a product → upload photos or a GLB
   → 3D model generated + optimized → configure the AR button
   → publish → shoppers see "View in AR" in the live storefront
   → dashboard shows sessions, try-ons, conversion uplift
```

### Shopper journey — anonymous, simple, enormous volume

```
Shopper opens a product page in the merchant's storefront
   → embedded widget loads from CDN (< 60 KB gzipped)
   → taps "View in AR" → camera opens (WebXR / Quick Look / Scene Viewer)
   → optionally tries the item on (face/hand tracking, on-device)
   → AI suggests matching items
   → add to cart
```

**These two populations have nothing in common technically.** ~500–5,000 merchants total;
~100,000 shoppers/day. The architecture in §8 separates them completely.

---

## 4. The five architectural decisions that define the system

Everything else is negotiable. These are not.

### D1 — Shared database, shared schema, `tenant_id` column, enforced by Postgres RLS

Not schema-per-tenant, not database-per-tenant. At 1,000+ tenants, per-schema migrations
become 1,000 migrations that can each fail individually, and connection pooling collapses.
Shared schema + Row-Level Security scales to tens of thousands of tenants on one migration
path.

**Isolation is enforced by the database, not by remembering a `WHERE` clause.**
Application-layer filtering fails the day one query forgets it. RLS makes that class of bug
impossible rather than unlikely.

*Rollback: very expensive — this is the foundation.*

### D2 — Try-on inference runs in the shopper's browser. Permanently.

MediaPipe Tasks Vision (WASM + WebGL) does face and hand landmark detection on device.

| Approach | Cost at 30k sessions/day | Privacy |
|---|---|---|
| Server-side GPU | ~$8,000–15,000/month | Camera frames leave the device — heavy PDPL burden |
| **Client-side** | **$0** | Frames never leave the device |

It is not only a cost decision. *"Your camera image never leaves your phone"* is a sentence
you can put on the consent screen and mean literally. Server-side try-on would require
biometric-data consent, a retention policy and a breach surface.

If quality demands a bigger model, ship a bigger WASM model — the shopper's phone is free
compute you already have. *Rollback: never.*

### D3 — The shopper read path never touches Postgres

```
Shopper opens a product page
   ├── AR button + viewer JS  ──► CDN (static, immutable, versioned)
   ├── Viewer config JSON     ──► Edge Worker ──► Workers KV (~5 ms, no origin)
   ├── GLB / USDZ model       ──► R2 via CDN (immutable, cached forever)
   └── Analytics events       ──► Worker ──► buffered ──► ClickHouse (never Postgres)
```

When a merchant publishes AR settings, the API writes Postgres **and** enqueues a job that
renders a small immutable JSON blob into KV, keyed `cfg:{tenantId}:{productId}:{version}`.
Publishes are thousands/day; reads are hundreds of thousands/day. **Never make the read
side pay for the write side's complexity.**

**A consequence worth more than any SLA:** if the entire API and database are down,
shoppers still see AR. Merchants cannot log in, but no storefront breaks. The widget runs
inside *other people's* shops — it must not be able to break them.

*Rollback: very expensive — a rebuild of the shopper path.*

### D4 — Cloudflare R2 for all 3D assets (zero egress)

100k sessions × a 5 MB model ≈ 15 TB/month of egress.

| Provider | Egress at 15 TB/month |
|---|---|
| AWS S3 + CloudFront | ~$1,300 |
| Google Cloud Storage | ~$1,700 |
| **Cloudflare R2 + CDN** | **$0** (~$45 storage) |

Then make the files smaller anyway: Draco (70–90% of mesh), KTX2/Basis (60–80% of
textures), meshopt (20–30%), LOD tiers, `Cache-Control: immutable` with the version in the
filename. **Target < 2 MB per model.** A 5 MB model that becomes 1.5 MB loads in 2 seconds
instead of 8 on Saudi mobile networks — and slow AR is unused AR.

*Rollback: low — swap the storage adapter. Name the column `storage_key`, never `r2_key`.*

### D5 — Analytics never enters Postgres

2.5M events/day would bloat the WAL, wreck autovacuum and slowly degrade every merchant
query. Events go: browser SDK (batched, `sendBeacon`) → edge Worker (validate, bot-filter,
enrich geo) → buffered insert → ClickHouse → materialized views → rollups. **Dashboard
charts read rollups only**, cached 60s in Redis. Raw events retained 90 days; rollups
forever.

*Rollback: medium.*

---

## 5. Tech stack

### Languages — exactly three

| Language | Used for |
|---|---|
| **TypeScript** | Web apps, API, workers, edge functions, AR viewer, shared packages |
| **Python** | AI services only (FastAPI): generation orchestration, embeddings, image quality |
| **SQL** | Migrations, analytical queries, RLS policies — written by hand where it matters |

**Do not add a fourth.** Not Go for "performance", not Rust for the edge. At this scale
neither is warranted, and each language multiplies the maintenance surface.

### Frontend

| Concern | Choice | Note |
|---|---|---|
| Framework | **Next.js 16 (App Router)** | Separate apps for dashboard and admin. Next 16 renames the `middleware.ts` convention to `proxy.ts`. |
| Marketing site | **Astro** | Not Next — see §13. A Next marketing site could not hit the JS budget. |
| Language | TypeScript `strict: true` | |
| Styling | **Tailwind CSS v4** | Logical properties (`ms-`, `me-`, `ps-`) so RTL works without a mirrored stylesheet |
| Components | **shadcn/ui** (Radix) | Copied into the repo, not a dependency. Radix handles RTL and a11y correctly. |
| Forms | react-hook-form + zod | The same zod schemas as the API, via `packages/contracts` |
| Server state | TanStack Query | |
| Tables | TanStack Table | ~40 table screens — one pattern for all of them |
| Charts | Recharts | |
| i18n | **next-intl** | Arabic default, English secondary, `dir="rtl"` on `<html>` |
| Fonts | IBM Plex Sans Arabic + Inter | Self-hosted, subset. **Never Arial for Arabic.** |
| Client state | Zustand, only where needed | Server state belongs to TanStack Query, not a store |

### Backend

| Concern | Choice | Note |
|---|---|---|
| Framework | **NestJS 11 on Fastify** | Fastify adapter, not Express — roughly 2× throughput, and the module system keeps 60+ features navigable |
| ORM | **Drizzle** | SQL-first, and it lets you run `SET LOCAL app.tenant_id` inside a transaction so RLS actually enforces isolation. This is the deciding factor over Prisma. |
| Validation | zod | Shared with the frontend |
| Queue | **BullMQ** (Redis) | Job state, retries, backoff, dead-letter, repeatable jobs |
| Cache | Redis 7 | Tenant-prefixed keys, always |
| Auth | Hand-rolled: argon2id + 15-min JWT access + rotating refresh in an httpOnly cookie | Salla/Zid OAuth and the tenant-membership model are too specific for an off-the-shelf provider, and PDPL means identity data stays in our own database |
| API style | REST + OpenAPI | Generated client in `packages/api-client`. GraphQL adds nothing here. |
| Errors | RFC 9457 `application/problem+json` | |

### Data

| Store | Purpose |
|---|---|
| **PostgreSQL 16** | Everything transactional — tenants, users, billing, products, models, jobs |
| **pgvector** | Product embeddings. ~1M vectors is nothing. **Do not add a dedicated vector database.** |
| **ClickHouse** | Analytics events, AR/try-on sessions, rollups |
| **Redis 7** | Cache, queues, rate limits, sessions |
| **Cloudflare R2** | 3D models, textures, images, invoice PDFs |
| **Cloudflare KV** | Edge-cached viewer config |

### AI / ML

| Concern | Choice |
|---|---|
| Service | FastAPI + Pydantic v2 + uvicorn — one service, versioned contracts, called **only** by the TS worker (never by a browser, never by the API directly) |
| Try-on inference | **MediaPipe Tasks Vision, in the browser.** Face Landmarker (glasses), Hand Landmarker (watches/rings) |
| 3D generation | Managed API first (Meshy / Tripo3D / CSM) behind an adapter interface; self-host TripoSR / Hunyuan3D-2 later |
| Post-processing | `gltf-transform` (Draco + meshopt), USDZ conversion, in a TypeScript worker |
| Embeddings | Multilingual model (Arabic + English) → pgvector |
| Text generation | Claude API, behind `packages/ai` — Arabic product descriptions, attribute extraction |
| Registry | `model_registry` table: version, active flag, A/B split, rollback. **Never hardcode a model name in business logic.** |

### AR

| Concern | Choice |
|---|---|
| Viewer | **`<model-viewer>`** for ~90% of cases — it already solves iOS Quick Look (USDZ), Android Scene Viewer and WebXR from one tag. Do not rebuild this. |
| Custom scenes | Three.js (+ React Three Fiber in the dashboard 3D editor only) |
| Formats | **GLB** (Android/web) + **USDZ** (iOS) — generate both, always |
| Try-on rendering | Three.js + MediaPipe landmarks, in a Web Worker |
| Bundle budget | Viewer widget **< 60 KB gzipped**, self-contained, versioned on CDN |

### Infrastructure

| Concern | Start (0–5k merchants) | Scale |
|---|---|---|
| Compute | Hetzner dedicated (AX41/AX52) + Dokploy | GCP `me-central2` (Dammam) for PDPL residency |
| Orchestration | Docker Compose → Dokploy | k3s or GKE Autopilot |
| Database | Managed Postgres or self-hosted + PgBouncer | Cloud SQL HA + read replicas |
| CDN / edge | Cloudflare (CDN, R2, Workers, KV, WAF, DNS) | Same — no migration needed |
| CI/CD | GitHub Actions | Same |
| Secrets | Infisical (self-hosted) or Doppler | Same |

### KSA vendors

| Need | Primary | Backup | Note |
|---|---|---|---|
| Payments | **Moyasar** | Tap, HyperPay | Mada, Apple Pay, STC Pay, cards. Always behind a `PaymentProvider` interface. |
| E-invoicing | **A ZATCA-certified provider** (Wafeq, Qoyod, ClearTax) | — | **Do not build Phase 2 Fatoora yourself.** Cryptographic stamping and CSID lifecycle are weeks of work and a compliance liability. Buy it. |
| SMS / OTP | **Unifonic** | Taqnyat, Msegat | |
| WhatsApp | Meta Cloud API via Unifonic or 360dialog | — | Expected in KSA, not optional |
| Email | **Resend** | Amazon SES | |
| Errors | Sentry | | |
| Traces / logs | OpenTelemetry → Axiom or Grafana Cloud | Loki + Tempo | |
| Uptime | Better Stack | | Drives the public status page |

### Testing

| Type | Tool | Where |
|---|---|---|
| Unit | Vitest | All packages |
| Integration | Vitest + Testcontainers (**real** Postgres) | API — RLS cannot be tested against a mock |
| API e2e | Pactum | API |
| Web e2e | Playwright, including an RTL pass | Dashboard, marketing |
| Load | k6 | Viewer path, sync engine, event collector |
| Security | `pnpm audit`, Semgrep | CI |

**One suite is special:** `packages/testing/tenant-isolation`. It attempts cross-tenant
access through every layer — API, cache, jobs, analytics — and must fail every attempt. It
runs on every PR and at every phase gate.

### Cost at 100k shoppers/day

| Item | Monthly (USD) |
|---|---|
| Hetzner (3 servers) | ~$180 |
| Managed Postgres + replica | ~$200 |
| ClickHouse | ~$150 |
| Redis | ~$60 |
| **R2 storage + egress** | **~$45** (vs ~$2,700 on S3) |
| Cloudflare Workers/KV | ~$50 |
| 3D generation API | ~$500 |
| **Try-on inference** | **$0** (client-side) |
| Email / SMS / WhatsApp | ~$300 |
| Monitoring | ~$150 |
| **Total** | **~$1,650** |

---

## 6. Repository structure

Monorepo: **pnpm workspaces + Turborepo**. One repo, many deployables, shared types.

```
tajribah/
├── apps/
│   ├── dashboard/     # Next.js — merchant dashboard (MD-*, ONB-*, AUTH-*)
│   ├── marketing/     # Astro — tajribah.com (MKT-*), static-first
│   ├── admin/         # Next.js — super admin console (ADM-*)
│   ├── api/           # NestJS — the core API
│   ├── worker/        # NestJS standalone — BullMQ consumers, no HTTP
│   ├── viewer/        # Vite — the embeddable AR widget (SHOP-*), < 60 KB gzip
│   └── edge/          # Cloudflare Workers — viewer config + event collector
├── packages/
│   ├── contracts/     # zod schemas + TS types shared by API and web — source of truth
│   ├── db/            # Drizzle schema, migrations, seeds, RLS policies
│   ├── ui/            # shadcn components, design tokens, RTL primitives
│   ├── i18n/          # ar/en catalogs, formatters (SAR, Hijri, +966)
│   ├── api-client/    # typed client generated from OpenAPI
│   ├── connectors/    # Salla / Zid / Shopify / WooCommerce adapters
│   ├── ai/            # AI service client, prompt templates, model registry client
│   ├── ar-core/       # shared 3D/AR logic between viewer and dashboard editor
│   ├── analytics/     # event schema, browser SDK, ClickHouse client
│   ├── billing/       # plans, entitlements, proration, VAT, invoice numbering
│   ├── model-optimize/# Draco/meshopt/KTX2 optimizer
│   ├── model-inspect/ # GLB/USDZ format validation
│   ├── storage/       # S3-compatible object storage, tenant-scoped keys
│   ├── config/        # env schema (zod), typed config loader
│   ├── logger/        # pino with tenant/request context
│   ├── testing/       # factories, fixtures, tenant-isolation suite
│   └── tsconfig/
├── services/
│   └── ai/            # Python 3.12 + FastAPI (routers, adapters, pipelines, contracts)
├── infra/
│   ├── docker/        # compose.dev.yml: postgres, redis, clickhouse, minio, mailpit
│   ├── clickhouse/    # table DDL + materialized views
│   ├── deploy/        # Dokploy / k8s manifests
│   └── scripts/       # db reset, seed, backup verify
└── docs/
```

**Why four frontends instead of one.** Different audiences, deploy cadences and risk
profiles. Marketing is static and SEO-critical. Dashboard is authenticated and heavy. Admin
is internal and must never share a bundle with anything public. The viewer runs inside
*other people's* websites and lives or dies on bundle size.

**`apps/viewer` is not a Next.js app.** It is a Vite library build producing one
self-contained JS file served from the CDN. Every kilobyte is paid for 100,000 times a day.

**`packages/contracts` is load-bearing.** Every request/response shape is a zod schema
there. The API validates with it, the frontend infers types from it, tests generate
fixtures from it. When a contract changes, everything that depends on it fails to
compile — which is the point.

### Inside the API

```
apps/api/src/
├── core/                    # cross-cutting — features never import this from outside
│   ├── tenancy/             # TenantContext, guard, RLS transaction wrapper
│   ├── auth/                # JWT strategy, guards, decorators
│   ├── rbac/                # permissions, @RequirePermission()
│   ├── audit/  errors/  idempotency/  ratelimit/
└── modules/                 # one folder per bounded context
    ├── tenants/  users/  onboarding/  connections/  products/
    ├── models3d/  ar/  tryon/  ai-jobs/  billing/
    └── analytics/  support/  admin/
```

Each module has the same shape: `*.module.ts`, `*.controller.ts` (HTTP only, no business
logic), `*.service.ts` (business logic), `*.repository.ts` (**the only place SQL lives**),
`dto/`, `__tests__/`.

**Modules do not import each other's repositories.** Cross-module needs go through the
other module's *service*, or through an event. This is what keeps 13 modules from becoming
one tangle.

### Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Folders / files | kebab-case | `product-sync.service.ts` |
| React components | PascalCase | `ProductTable.tsx` |
| Hooks | `use` + camelCase | `useTenantProducts.ts` |
| DB tables | snake_case, plural | `store_connections` |
| DB columns | snake_case | `tenant_id`, `created_at` |
| Enums (DB) | snake_case type, lowercase values | `job_status` → `queued` |
| Env vars | SCREAMING_SNAKE | `SALLA_CLIENT_SECRET` |
| Queues | `domain.action` | `sync.products`, `ai.generate-3d` |
| Redis keys | `t:{tenantId}:{domain}:{id}` | `t:9f2:product:118` |
| Events | `domain.thing.past-tense` | `product.sync.completed` |
| Feature flags | kebab-case | `tryon-rings` |

**The Redis key format is a rule, not a suggestion.** Tenant prefix first, always. A cache
key without a tenant prefix is a cross-tenant leak waiting for a collision.

**Screen-ID comments.** Every page file starts with its inventory ID:

```tsx
// MD-010 — Products table view
```

That is how ~372 screens stay traceable. `grep -r "MD-0" apps/dashboard` tells you
instantly what exists and what does not, months from now.

---

## 7. Data model

Postgres 16 for everything transactional (~60 tables). ClickHouse for analytics events.

### 7.1 How RLS is wired — get this exactly right once

Every tenant-scoped table:

```sql
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE products FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON products
  USING      (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
```

```sql
CREATE FUNCTION current_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;
```

Every request opens a transaction and sets the tenant first:

```ts
await db.transaction(async (tx) => {
  await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
  return tx.select().from(products);   // RLS applies automatically
});
```

**Four rules that make this actually safe:**

1. **Use the `NULLIF` function, never `current_setting(...)::uuid` inline.** Once a
   transaction-local GUC has been set on a connection, `COMMIT` resets it to the **empty
   string, not NULL**. The inline version then evaluates `''::uuid` and raises
   `invalid input syntax for type uuid` on the next query that runs without a tenant — so
   "no tenant context" becomes a 500 instead of an empty result. It passes on a fresh
   connection and fails only after reuse: exactly the kind of bug that survives development
   and appears in production. `NULLIF` turns the empty string back into NULL, and
   `tenant_id = NULL` is NULL, so the row is filtered out. Fail closed.
2. **`FORCE ROW LEVEL SECURITY`**, or the table owner bypasses the policy silently.
3. **The application connects as a non-superuser, non-owner role** (`tajribah_app`). A
   superuser ignores RLS entirely.
4. **`set_config(..., true)` is transaction-local.** With PgBouncer transaction pooling a
   session-local setting would leak across tenants when the connection is reused. **This is
   the single most dangerous bug available in this architecture** — implement it once in
   `core/tenancy` and never write a raw tenant query outside it.

Migrations and background jobs use a separate `tajribah_admin` role that bypasses RLS
deliberately, and every such query must filter by tenant explicitly. **See §13.2 — a
`BYPASSRLS` role beats `FORCE ROW LEVEL SECURITY`, so a "tenant-scoped" helper that wraps
the admin client scopes nothing at all.**

### 7.2 Conventions

- Primary keys: `uuid` v7 (time-ordered — better index locality than v4)
- Every table: `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz`
- Soft delete where recovery matters: `deleted_at` + partial index `WHERE deleted_at IS NULL`
- Money: `numeric(12,2)` plus `currency char(3)`. **Never floats.**
- Every FK indexed; composite indexes lead with `tenant_id`
- JSONB for provider-specific payloads only, never for queryable business data

### 7.3 Identity & tenancy

```
tenants              id, slug, name, name_ar, status(active|trial|suspended|cancelled),
                     plan_id, trial_ends_at, country, timezone, locale, currency,
                     cr_number, vat_number, national_address, logo_url, city,
                     product_category(jewelry|watch|eyewear|bag|apparel|furniture|other),
                     goal(ar_viewer|virtual_tryon|ai_3d_models), onboarding_state jsonb
tenant_settings      tenant_id PK, branding jsonb, white_label, custom_domain,
                     consent_text_ar/en, notification_prefs jsonb
users                id, email UNIQUE, email_verified_at, phone, phone_verified_at,
                     password_hash (argon2id), full_name, locale, avatar_url,
                     totp_secret_encrypted, totp_enabled, backup_codes_hash,
                     last_login_at, failed_login_count, locked_until, is_staff
tenant_memberships   id, tenant_id, user_id, role(owner|admin|editor|analyst|viewer),
                     custom_role_id, status, invited_by, UNIQUE(tenant_id, user_id)
invitations          id, tenant_id, email, role, token_hash, expires_at, accepted_at
custom_roles         id, tenant_id, name, permissions text[]        -- Enterprise only
sessions             id, user_id, tenant_id, refresh_token_hash, user_agent,
                     ip_hash, expires_at, revoked_at, last_seen_at
api_keys             id, tenant_id, name, key_prefix, key_hash, scopes text[], ...
audit_logs           id, tenant_id, actor_user_id, actor_type, action, resource_type,
                     resource_id, changes jsonb, ip_hash, request_id  -- PARTITION BY month
impersonation_logs   id, staff_user_id, tenant_id, reason, started_at, ended_at
```

**`users` is global, not tenant-scoped** — one person can belong to several stores (the
tenant switcher). Tenancy lives in `tenant_memberships`. `users` therefore has **no** RLS
policy; access is controlled at the API layer. This is the one exception to "everything has
RLS", and it looks like a bug if you forget why — note it wherever it comes up.

### 7.4 Billing

```
plans                 id, code(starter|growth|pro|enterprise), name, name_ar,
                      price_monthly, price_annual, currency, is_public, sort_order
plan_limits           plan_id, key(products|ai_credits|storage_gb|ar_sessions|
                      team_members|bandwidth_gb), value int     -- -1 = unlimited
plan_features         plan_id, feature_key, enabled
subscriptions         id, tenant_id, plan_id, status(trialing|active|past_due|paused|
                      cancelled|expired), billing_cycle, current_period_start/end,
                      cancel_at_period_end, provider, provider_subscription_id, coupon_id
subscription_changes  id, subscription_id, from_plan_id, to_plan_id, change_type,
                      proration_amount, effective_at, created_by     -- append-only
payment_methods       id, tenant_id, type(mada|card|applepay|stcpay|bank_transfer), ...
invoices              id, tenant_id, invoice_number UNIQUE, subscription_id, status,
                      subtotal, vat_rate(0.15), vat_amount, total, currency,
                      issued_at, due_at, paid_at, pdf_storage_key,
                      zatca_uuid, zatca_hash, zatca_qr, zatca_status,
                      buyer_vat_number, buyer_cr_number
invoice_lines         id, invoice_id, description, description_ar, quantity,
                      unit_price, amount, tax_amount
payments              id, tenant_id, invoice_id, amount, currency, status,
                      provider, provider_payment_id UNIQUE, failure_code,
                      idempotency_key UNIQUE, raw_response jsonb
refunds               id, payment_id, amount, reason, status, provider_refund_id
coupons               / coupon_redemptions
credit_ledger         id, tenant_id, delta int, balance_after int, reason, reference_*
                                                                     -- APPEND ONLY
usage_counters        tenant_id, period_start, metric, value   -- PK all three
dunning_attempts      id, subscription_id, attempt_number, attempted_at, outcome
billing_events        id, provider, provider_event_id UNIQUE, event_type,
                      payload jsonb, processed_at, error        -- webhook idempotency
```

**Three billing rules that are not optional:**

1. **`credit_ledger` is append-only.** Never `UPDATE` a balance. Balance is the sum of
   deltas; `balance_after` is a denormalized convenience column written in the same
   transaction. Any dispute is answerable by replaying the ledger.
2. **`billing_events.provider_event_id` is UNIQUE.** Every payment webhook inserts there
   *first*. A duplicate insert fails and the handler exits without touching anything. This
   is what makes double-charging structurally impossible rather than merely unlikely —
   payment providers *will* deliver the same event twice.
3. **Invoice numbers are gapless.** ZATCA requires sequential numbering with no gaps. Use a
   dedicated Postgres sequence per tenant per year, allocated inside the invoice-creation
   transaction — never `count(*) + 1`, and never a sequence that increments on rollback.

### 7.5 Store connections

```
store_connections  id, tenant_id, provider(salla|zid|shopify|woocommerce),
                   external_store_id, store_name, store_url,
                   access_token_encrypted, refresh_token_encrypted, token_expires_at,
                   scopes text[], status(active|expired|revoked|error),
                   last_sync_at, sync_interval_minutes, last_error, health_score,
                   settings jsonb, UNIQUE(provider, external_store_id)
sync_jobs          id, tenant_id, connection_id, type(full|incremental|single_product|
                   inventory|orders), status, cursor, total_items, processed_items,
                   failed_items, started_at, finished_at, error, triggered_by
sync_job_items     id, sync_job_id, tenant_id, external_id, product_id,
                   action(created|updated|skipped|failed), error   -- PARTITION BY month
webhook_events     id, tenant_id, connection_id, provider, provider_event_id, topic,
                   payload jsonb, signature_valid, status(received|processed|failed|
                   ignored), processed_at, error, attempts,
                   UNIQUE(provider, provider_event_id)             -- idempotency
field_mappings     id, tenant_id, connection_id, source_field, target_field, transform
```

Tokens are encrypted at rest with AES-256-GCM using a key from the secret manager — never
stored plaintext, never logged, never returned by any API endpoint.

### 7.6 Catalogue

```
products          id, tenant_id, connection_id, external_id, sku,
                  name, name_ar, description, description_ar,
                  price, compare_at_price, currency, category_id,
                  product_type(jewelry|watch|eyewear|bag|apparel|furniture|other),
                  images jsonb, attributes jsonb, status(active|draft|archived),
                  ar_enabled, tryon_enabled, ai_enabled,
                  primary_model_id, embedding vector(768), synced_at, deleted_at,
                  UNIQUE(tenant_id, connection_id, external_id)
product_variants  id, tenant_id, product_id, external_id, sku, title, options jsonb,
                  price, inventory_quantity, image_url, model_id
categories        id, tenant_id, parent_id, name, name_ar, slug, sort_order
```

```sql
CREATE INDEX ON products (tenant_id, status, created_at DESC);
CREATE INDEX ON products (tenant_id, ar_enabled) WHERE deleted_at IS NULL;
CREATE INDEX ON products USING gin  (to_tsvector('arabic', name_ar));
CREATE INDEX ON products USING hnsw (embedding vector_cosine_ops);
```

### 7.7 3D models & AR

```
models_3d       id, tenant_id, product_id, variant_id, name,
                source(uploaded|ai_generated|professional_service),
                status(draft|processing|ready|failed|archived),
                current_version_id, qa_status(pending|approved|rejected),
                qa_reviewed_by, qa_notes, created_by
model_versions  id, model_id, tenant_id, version int, status, poly_count,
                material_count, texture_count, bounding_box jsonb, source_job_id,
                published_at, created_by
model_files     id, model_version_id, tenant_id, format(glb|usdz|gltf|fbx|obj),
                variant(original|optimized|lod1|lod2), storage_key, cdn_url,
                file_size_bytes, checksum, original_filename,
                compression(none|draco|meshopt)
ar_configs      id, tenant_id, product_id, button_style jsonb, button_label_ar/en,
                placement(floor|wall|table|face|wrist), scale_factor, auto_rotate,
                shadow_intensity, environment_hdri, camera_orbit, hotspots jsonb,
                published_version int, published_at
tryon_configs   id, tenant_id, product_id,
                category(glasses|watch|ring|necklace|earring|bag),
                anchor_points jsonb, scale_reference, offset jsonb,
                occlusion_enabled, quality_score, calibrated_at
qr_codes        id, tenant_id, product_id, code UNIQUE, short_url, label, scan_count
hosted_pages    id, tenant_id, product_id, slug UNIQUE, theme jsonb, is_active, view_count
```

**`model_files` is deliberately one row per file.** A single version produces GLB, USDZ, an
optimized GLB and two LOD levels — five rows. The viewer picks the right one for the device
and connection. Columns on `model_versions` would break the moment a sixth format appears.

**`models_3d.current_version_id` is the only marker of the live version — do not add
`is_current` to `model_versions`.** A flag on many rows and a pointer on one are two
sources of truth for one fact, and nothing in the database can make them agree. A single
nullable column can only ever name one version, by construction. (Expose `isCurrent` in the
API response, computed.)

### 7.8 AI jobs

```
ai_jobs            id, tenant_id, type(generate_3d|enhance_texture|embed_product|
                   enrich_content|quality_check|convert_format),
                   status(queued|processing|done|failed|cancelled), priority,
                   input jsonb, output jsonb, model_registry_id,
                   credits_cost, actual_cost_usd, gpu_seconds,
                   queued_at, started_at, finished_at, error_code, error_message,
                   attempts, parent_job_id                     -- PARTITION BY month
ai_job_events      id, job_id, tenant_id, event, detail jsonb
model_registry     id, name, version, provider, endpoint, is_active, ab_split_percent,
                   cost_per_call, avg_latency_ms, success_rate, rolled_back_at
generation_inputs  id, job_id, tenant_id, angle(front|side|back|detail),
                   storage_key, quality_score, issues text[]
professional_orders id, tenant_id, product_id, status, requested_at, assigned_to, price
```

Every AI job records `credits_cost` (what the merchant is charged) **and**
`actual_cost_usd` (what it cost us). Without both numbers you cannot tell whether a plan is
profitable, and **AI features are exactly where SaaS margins quietly die.**

### 7.9 Everything else

```
recommendation_configs, comparison_configs, tickets, ticket_messages,
notifications, feature_flags, announcements,
data_requests (type: export|erase — PDPL)
```

### 7.10 ClickHouse

```sql
CREATE TABLE events (
  tenant_id     UUID,
  event_type    LowCardinality(String),  -- product_view, ar_open, ar_place,
                                         -- tryon_start, tryon_capture, add_to_cart, purchase
  product_id    UUID,
  session_id    String,                  -- rotating, salted daily — not an identity
  occurred_at   DateTime64(3),
  device_type   LowCardinality(String),
  os            LowCardinality(String),
  browser       LowCardinality(String),
  country       LowCardinality(String),
  region        LowCardinality(String),
  referrer_host String,
  ar_supported  UInt8,
  duration_ms   UInt32,
  value         Decimal(12,2),
  currency      LowCardinality(String),
  properties    Map(String, String)
) ENGINE = MergeTree
PARTITION BY toYYYYMM(occurred_at)
ORDER BY (tenant_id, event_type, occurred_at)
TTL occurred_at + INTERVAL 90 DAY;
```

Plus materialized views rolling up to `daily_product_stats`, `daily_tenant_stats`,
`funnel_daily`, `device_breakdown_daily`, retained indefinitely.

**Privacy:** no IP addresses, no raw user agents, no cross-site identifiers, no shopper
identity. `session_id` is a salted hash rotated every 24 hours, which makes it useless for
tracking a person across days — deliberately.

### 7.11 Migration rules

- Drizzle Kit generates; **every migration is reviewed by hand** before it runs anywhere
- One logical change per migration
- Every migration file carries a matching `-- ROLLBACK:` comment block with the reverse SQL
- **Expand → migrate → contract** for anything breaking: add the nullable column and
  deploy; backfill in batches and dual-write; drop the old column in a *later* release
- Never `ALTER TABLE ... ADD COLUMN NOT NULL DEFAULT <volatile>` on a large table
- Always `CREATE INDEX CONCURRENTLY` in production
- Test on a restored production-sized dump before shipping

**Checklist for every new table:**

- [ ] `tenant_id uuid NOT NULL REFERENCES tenants(id)` if tenant-scoped
- [ ] RLS enabled **and** forced, with a policy
- [ ] Indexes on all FKs; composite index leading with `tenant_id` for the real queries
- [ ] `created_at` / `updated_at`
- [ ] Added to the tenant-isolation test suite
- [ ] Rollback SQL written
- [ ] Partitioning considered if it grows per-event rather than per-entity
- [ ] Grants reviewed — see §13.2

---

## 8. Architecture for 100,000 active users/day

### What the number actually means

| Population | Count | Traffic shape |
|---|---|---|
| **Merchants** (tenants) | ~500–5,000 total, ~1,000 daily | Heavy, authenticated, complex queries — low volume |
| **Shoppers** | **100,000/day** | Simple, anonymous, read-only — enormous volume |

| Metric | Estimate |
|---|---|
| Product/AR page views | ~400,000/day |
| AR sessions | ~100,000/day |
| Try-on sessions | ~30,000/day |
| Analytics events | ~2,500,000/day (~30/session) |
| Peak RPS (evening window, ×4 average) | ~150–250 |
| 3D model bandwidth | **~300 GB – 1 TB/day** |

**The honest read:** 250 rps of *simple reads* is not a hard engineering problem — one
well-configured server handles it. Three things could still sink you, and §4 answers each:
bandwidth cost for 3D models (D4), GPU cost for try-on (D2), analytics writes destroying
the transactional database (D5).

### Database discipline at scale

| Practice | Detail |
|---|---|
| **RLS everywhere** | Isolation in the database, not in a remembered `WHERE` clause |
| **PgBouncer** | Transaction pooling. NestJS + Drizzle open far more connections than Postgres wants |
| **Index every filter** | Composite indexes lead with `tenant_id`: `(tenant_id, status, created_at DESC)` |
| **Partition the big ones** | `ai_jobs`, `sync_job_items`, `audit_logs`, `webhook_events` by month |
| **Read replica** | Admin dashboards and exports read the replica; merchants read primary |
| **No unbounded queries** | Cursor pagination, hard `LIMIT`, 5s statement timeout on the API role |

### Jobs and backpressure

| Queue | Priority | Concurrency | Note |
|---|---|---|---|
| `sync.products` | normal | 10/tenant | Rate-limited to the provider's API budget |
| `ai.generate-3d` | low | GPU-bound | Slow by nature; tell merchants upfront |
| `ai.postprocess` | normal | 20 | CPU-bound compression |
| `edge.publish-config` | **high** | 50 | Merchant-visible latency — must feel instant |
| `notify.*` | low | 20 | |
| `analytics.rollup` | low | 2 | Scheduled |

Rules: every job is idempotent; every job carries `tenantId` in its payload and its logs;
every job has `attempts: 5` with exponential backoff and a dead-letter queue; **no tenant
may occupy more than 20% of a queue's concurrency** — one merchant importing 50,000
products must not stall everyone else.

### Caching layers

| Layer | TTL | Invalidation |
|---|---|---|
| CDN — static assets, models | 1 year, `immutable` | Version in filename |
| Workers KV — viewer config | 5 min + explicit purge | Purged on publish |
| Redis — plan entitlements | 10 min | On subscription change |
| Redis — analytics rollups | 60 s | Time-based |
| Redis — product lists | 30 s | On product write |

Every Redis key starts `t:{tenantId}:`. No exceptions.

### Scaling stages — do not build stage 3 during stage 1

| Stage | Merchants | Shoppers/day | Setup |
|---|---|---|---|
| **1. Launch** | 0–50 | < 5k | 1 Hetzner box: API + worker + Postgres + Redis, Docker Compose |
| **2. Traction** | 50–300 | 5k–30k | 3 boxes: app / data / worker. Managed Postgres. ClickHouse added. |
| **3. Scale** | 300–1,000 | 30k–100k | Load-balanced API ×3, worker ×3, PgBouncer, read replica, autoscaling |
| **4. Regional** | 1,000+ | 100k+ | GCP `me-central2`, multi-AZ, HA Postgres, GPU pool if self-hosting |

**Build stage 1 infrastructure now — but write *code* that permits stages 2–4:** stateless
API processes, no local disk, no in-memory session state, no in-process job scheduling.
Those constraints cost nothing today and are extremely expensive to retrofit. Premature
Kubernetes at 50 merchants is how projects die before finding product-market fit.

### SLOs

| Path | Target |
|---|---|
| Viewer config (edge) | p95 < 50 ms |
| Model download start | p95 < 200 ms |
| AR viewer interactive | p95 < 3 s on 4G |
| Dashboard API read | p95 < 300 ms |
| Dashboard API write | p95 < 800 ms |
| Event ingest | p99 < 100 ms (fire-and-forget) |
| Uptime — shopper path | 99.95% |
| Uptime — merchant dashboard | 99.9% |

The shopper path gets the higher target because it fails in *someone else's* storefront, in
front of *their* customer.

### Load tests that must exist before launch (k6, in `packages/testing/load/`)

1. **Viewer path** — 5,000 rps sustained against edge config + CDN, 10 minutes
2. **Event ingest** — 3,000 events/sec, zero loss, ClickHouse lag < 30s
3. **Dashboard** — 500 concurrent merchants doing realistic navigation
4. **Sync storm** — 50 tenants full-syncing 5,000 products each simultaneously
5. **Queue flood** — 10,000 3D jobs queued at once; fair scheduling, no starvation

Each has a documented pass threshold. They run at the P1, P4 and P7 gates, and any
regression blocks the gate.

---

## 9. The build plan — phases, packages, gates

> **Amended 2026-10-05 (Nader's decision, DECISIONS T81).** This version brings a store's products in from its
> **product feed link or a file** (Google Merchant Center's way) — not by linking its platform. Linking Salla, Zid,
> Shopify and WooCommerce moves to **version 2**: P1.4, P1.5, P4.7 and the P6 connectors are built where they could
> be, kept and tested, but not offered (`STORE_LINKING` in `tajribah-platform/lib/features.ts`). Where this plan says
> "connect Salla", read "import from a feed link or a file" until then. PROGRESS.md has the "Version 2 — later" list.

**231 work packages. One package ≈ one focused work session (half a day to two days).**

### The shape

```
SPINE (sequential, gated)

P0 Foundation ──► P1 Core loop ──► P2 Billing ──► P3 3D pipeline
                                                        │
        P7 Scale ◄── P6 AI + connectors ◄── P5 Try-on ◄── P4 Analytics
             │
             └──► P8 Enterprise & expansion

PARALLEL TRACKS
Track M — Marketing site (M1–M12)   opens after gate P0
Track A — Admin console  (A1–A14)   opens after P2.1
```

The spine is sequential because each phase depends on the last. The tracks are parallel
because the marketing site and admin console do not block product work — interleave them
when the spine is blocked on an external account.

### Phase summary

| Phase | Name | WPs | Ships | Gate |
|---|---|---|---|---|
| **P0** | Foundation | 20 | Nothing user-visible. Monorepo, DB, auth, RLS, CI, tests. | Isolation suite green; CI passing; staging deployed |
| **P1** | Core loop | 26 | **First revenue-capable product.** Signup → Salla → sync → AR live in a real storefront. | A real merchant completes the loop unaided; viewer load test @5k rps |
| **P2** | Billing | 15 | Merchants can pay. Plans, subscriptions, ZATCA invoices, quotas. | Full payment cycle incl. failure + refund + duplicate-webhook test |
| **P3** | 3D pipeline | 12 | Photos → 3D model, automated. | 20 real products generated, QA-approved, avg < 2 MB |
| **P4** | Analytics | 12 | Merchants see ROI. | 3k events/sec ingest, zero loss, rollups < 30s lag |
| **P5** | Try-on | 14 | Glasses, watches, rings, necklaces, bags — in-browser. | 30 fps on a mid-range Android; no frame leaves the device |
| **P6** | AI + connectors | 16 | Recommendations, comparison, Arabic enrichment. Zid, Shopify, Woo. | Recs lift measured; all 4 connectors pass the same conformance suite |
| **P7** | Scale & hardening | 13 | Survives 100k/day. | All 5 load tests pass; DR restore drill; security review clean |
| **P8** | Enterprise | 12 | Public API, white-label, SSO, GCC. | External developer integrates using only public docs |
| **M** | Marketing site | 12 | tajribah.com | Lighthouse ≥ 95, Arabic SEO indexed |
| **A** | Admin console | 14 | Internal operations. | Support resolves a real ticket end-to-end without SQL |

### What a gate is

A gate is **not** "the packages are done". It is an independent check that the phase
achieved its purpose:

1. Verify every WP is genuinely done — the code exists and the tests run
2. Run the full suite including tenant-isolation
3. Run the load tests listed for that gate
4. Audit the phase against the Definition of Done
5. Produce a gate report: what passed, what failed, **what was quietly skipped**

**If a gate fails, fix it before moving on.** A skipped gate compounds — unwinding P1
tenant-isolation problems during P6 costs roughly ten times what fixing them at the P1 gate
would have. (The first attempt crossed two gates on instruction. See §13.7.)

### Phase notes

**P0 — Foundation.** Zero user-visible output, and the most important phase. Everything
after inherits these decisions: RLS wiring, tenant context, the test harness, the error
model, the job framework. Rushing P0 to "get to the fun part" is the most common way this
kind of project fails, because the shortcuts become load-bearing. Highest-value packages:
tenancy + RLS, the isolation test harness, the job framework.

**P1 — Core loop.** The largest phase, and it produces something sellable. Contains the two
decisions from §4 that cannot be retrofitted: the edge config path and the viewer widget.
**Manual 3D upload comes *before* AI generation deliberately** — it proves the delivery
pipeline works with a known-good model, so when P3 generation misbehaves you know the
problem is generation, not delivery.

**P2 — Billing.** Idempotency everywhere. ZATCA via a certified provider, not hand-built.
The duplicate-webhook test is a gate requirement, not a nice-to-have.

**P3 — 3D pipeline.** Post-processing matters more than generation quality for the
business: it is what keeps models under 2 MB, and model size is both the bandwidth bill and
the AR load time.

**P4 — Analytics.** This is what merchants renew for. "Conversion uplift" and "return
reduction" are the two numbers that justify the subscription — they are the commercially
important packages, not the charts.

**P5 — Try-on.** Ordered by tracking difficulty: glasses (easiest, face landmarks are
extremely stable) → watches → rings → necklaces → bags. **Ship glasses fully before
starting watches.** All inference client-side, permanently.

**P6 — AI + connectors.** Zid can be pulled forward to just after the P2 gate if the market
demands it. **Build the connector conformance suite before the second connector, not after
the fourth** — it is what stops connector #4 from behaving subtly differently from #1.

**P7 — Scale & hardening.** Do not start early. Optimizing before you have real traffic
patterns optimizes the wrong things. The exception is code-level constraints (stateless
processes, no local disk) which apply from P0. Contains the migration to GCP `me-central2`
for PDPL residency — plan it before enterprise sales, not during.

**P8 — Enterprise.** Only worth building against real demand. An enterprise API with no
enterprise customer is expensive fiction.

**Track M — Marketing.** Home, pricing, how-it-works and the Salla landing page should
exist before you approach the first merchants.

**Track A — Admin.** Before it exists you will run SQL by hand to answer support
questions — acceptable for the first 20 merchants, painful past 50.

### Recommended change of order for the new build

The first attempt built in the order above and ran out of unblocked work. Do this instead:

> **Week 0, before any code: open every external account in §12.**
> Salla Partner, Cloudflare, domain + short domain, Moyasar, ZATCA provider, Unifonic,
> Hetzner, a 3D generation API. Several take days or weeks of review. They are the critical
> path; the code is not.

---

## 10. Screen inventory

~372 screens, each with a stable ID. **Put the ID in a comment at the top of every page
file.**

| Area | Code | Screens | Phase |
|---|---|---|---|
| Public marketing website | `MKT` | ~52 | 1 |
| Auth & account access | `AUTH` | ~26 | 1 |
| Merchant onboarding | `ONB` | ~16 | 1 |
| Merchant dashboard | `MD` | ~128 | 1–4 |
| Shopper / customer-facing AR | `SHOP` | ~34 | 1–4 |
| Super admin console | `ADM` | ~52 | 2–3 |
| System, states & shared | `SYS` | ~30 | All |
| Email / SMS / WhatsApp templates | `MSG` | ~34 | All |

The full row-by-row inventory is in `augmira-page-inventory.md` in the old repository —
carry it over as `tajribah-page-inventory.md`, content unchanged. **Keep the screen IDs
exactly as they are** (`MD-034`, `SHOP-20`, `ONB-15`…). They are the traceability mechanism
and the design deliverable list at once, and renumbering them to match a new name buys
nothing and breaks every reference in this document.

---

## 11. KSA rules — apply to every screen

| Rule | Detail |
|---|---|
| Direction | **RTL is the default layout**, LTR is the variant. Every screen needs both mirrors. |
| Language | Arabic (dialect-neutral MSA) + English toggle. Arabic UI labels run ~20–30% longer than English — design for it. |
| Font | Arabic: IBM Plex Sans Arabic / Tajawal / Cairo. Latin: Inter / Plus Jakarta. **Never Arial for Arabic.** |
| Currency | `ر.س` / SAR, format `299.00 ر.س`, no cents on marketing pages |
| Dates | Gregorian primary + optional Hijri (`12 رجب 1447`). **Weekend is Friday–Saturday.** |
| Tax | VAT 15% shown separately. Invoices must be **ZATCA Phase 2 compliant** — Fatoora QR, seller VAT no., buyer VAT no., UUID, invoice hash. |
| Identity fields | CR number (السجل التجاري), VAT number (الرقم الضريبي), National Address (العنوان الوطني), phone `+966 5X XXX XXXX` |
| Payments | Mada (primary), Visa/Mastercard, Apple Pay, STC Pay, bank transfer (SADAD); Tamara/Tabby for add-ons |
| Platforms | Salla and Zid get first-class treatment (logos, dedicated landing pages). Shopify/WooCommerce secondary. |
| Support | Sun–Thu 9am–6pm AST, plus a WhatsApp Business channel — expected in KSA, not optional |
| Timezone | Asia/Riyadh everywhere |

**PDPL (Saudi data protection):** personal data of Saudi residents may need to stay in KSA.
Hetzner (Germany) is fine pre-launch and for non-personal data; plan the move to GCP
`me-central2` before serious enterprise sales. It is far cheaper to plan for now than to
retrofit. Client-side try-on inference (D2) is a large part of why the PDPL story is simple.

---

## 12. External accounts — the real critical path

**This is what actually stopped the first build.** Roughly 16 of the 21 remaining P1
packages were blocked on accounts, not on code. Start all of these in week 0.

| # | Account | Blocks | Lead time |
|---|---|---|---|
| 1 | **Salla Partner account + app registration** | Salla OAuth, product mapping, connections UI, the entire core loop | Days–weeks (partner review) |
| 2 | **Cloudflare account** (R2 + Workers + KV + DNS) | Storage, the edge config path, the whole shopper read path | Hours |
| 3 | **`tajribah.com` + a short domain** for hosted AR pages | Hosted AR pages, QR codes, email links, the marketing site | Hours–days |
| 4 | **Moyasar merchant account** | 11 of 15 billing packages | Weeks (CR + bank verification) |
| 5 | **ZATCA Fatoora onboarding + CSID** | E-invoicing | Weeks |
| 6 | **Unifonic account** (SMS/WhatsApp) | Phone OTP, and staging deployment (the API will not boot in production mode without a real SMS provider) | Days |
| 7 | **Hetzner server + Dokploy** | Staging and production deployment, the P0 gate | Hours |
| 8 | **3D generation API** (Meshy / Tripo3D / CSM) | The whole 3D generation phase | Hours |
| 9 | **Zid Partner account** | Zid connector | Days–weeks |
| 10 | Sentry, Resend, Better Stack, Infisical | Observability, email, status page, secrets | Hours |

**Before spending money on any of the above, confirm the name is actually free** — the
`.com` and `.sa` domains, the short domain for AR links, the app name on the Salla and Zid
partner portals, and a Saudi trademark search. *Tajribah* is a common Arabic word, which
makes it memorable and also makes it contested. Settling this in week 0 costs an afternoon;
settling it after the Salla app is published and merchants have embedded the widget costs a
migration of every storefront that embedded it.

**Local prerequisites:** Docker with hardware virtualization enabled (the integration tests
run a real Postgres in a container — they cannot run without it), and **Node 22 on the
system PATH**. A Node version mismatch silently broke five of nine test scripts, every
browser check and every live round trip in the first build, and cost more time than any
single feature.

---

## 13. Lessons from the first build

*Read this section twice. Each item was found the hard way.*

### 13.1 The RLS trap that only appears in production

`current_setting('app.tenant_id', true)::uuid` inline in a policy **passes on a fresh
connection and fails after connection reuse**, because `COMMIT` resets a transaction-local
GUC to the empty string rather than NULL. `''::uuid` then raises
`invalid input syntax for type uuid`, so "no tenant context" becomes a 500 rather than an
empty result set. Always go through a `current_tenant_id()` function with `NULLIF`. See
§7.1.

### 13.2 A `BYPASSRLS` role beats `FORCE ROW LEVEL SECURITY`

A helper like `withTenant(adminClient, …)` **scopes nothing** — the admin role bypasses RLS
entirely, so the policy never runs and the helper's name is a lie. Any background code
reaching for the admin client must filter by tenant explicitly, and that must be tested.

Related grant problems, all real:

- `ALTER DEFAULT PRIVILEGES` had been granting the merchant API role full DML on **every
  new table**, including platform-configuration tables that should be read-only to it.
  Audit default privileges early; every new table inherits whatever you set once.
- **`GRANT SELECT` does not make a table read-only.** You need an explicit `REVOKE` first.
- **A partition is a table in its own right.** It needs its own `ENABLE`/`FORCE` RLS and its
  own policy. Isolation checks that name only the parent table will pass while a partition
  leaks. Make the isolation assertion walk partitions, structurally *and* behaviourally.

### 13.3 Verification that verifies nothing

Three CI checks passed for weeks without checking anything:

- `format:check` had **never** passed — and broke again the same way later. A formatter with
  no parser for a file type (e.g. `.astro`) silently skips those files.
- The "migration safety" CI step **had never run a migration** and printed a pass.
- A verify script that could not reach the API fell through to a stub and reported success.

**Rule:** every check must be able to fail. When you add one, break the thing it checks on
purpose and confirm the check goes red. A green check nobody has ever seen fail is
decoration.

### 13.4 "Done" must mean "I ran it"

Packages were recorded as done on code that had never been executed, and the gate audit
later found the DoD false for several of them. Adopt this literally: a package is done when
you have **run something and seen it pass** — typecheck and lint for the changed scope,
tests actually executed, the isolation test actually executed for anything tenant-scoped,
the page actually rendered for UI, and migrations applied forward **and rolled back once**
locally. If you could not verify something, write that down plainly rather than writing
"done".

### 13.5 The worker must be a process

`apps/worker` was a library with no entry point three separate times — meaning every
scheduled tick (sync scheduler, webhook dispatcher, rollups) had nowhere to run while
looking, in code review, exactly like working software. When you create the worker app,
create its `main.ts` and a container that runs it in the same package as the first job.

### 13.6 Small design decisions that were expensive to get wrong

| Area | The lesson |
|---|---|
| Auth | The access token lives **in memory only** — never localStorage, sessionStorage or a readable cookie; all three are readable by any script on the origin |
| Auth | Single-flight the refresh call with the **Web Locks API**, not just a shared promise (a shared promise does not cover multiple tabs) |
| Auth | Cap refresh-and-retry at exactly **one** attempt — the endpoint being retried is the one whose reuse detection revokes every session the user has |
| Auth | Rate-limit `/auth/refresh` **per session** (a hash of the refresh cookie), not per IP |
| Auth | Show **one** message for every credential failure — unknown email, wrong password, non-member must be indistinguishable |
| Auth | Validate a `?next=` parameter against an allow-list — it was a live open redirect |
| Webhooks | The signature needs the **raw body**, so the raw-body parser must *replace* the JSON parser on that route, not be added alongside it |
| Webhooks | Replay is a status change on `webhook_events`, not a second processing path — and a delivery whose signature failed must never be replayable |
| Webhooks | Claim work with `SELECT … FOR UPDATE SKIP LOCKED` inside the work transaction rather than adding a `processing` status |
| Jobs | One scheduler tick that reads the database beats a repeatable job per connection — the per-connection shape looks obvious and does not survive connections being added and removed |
| Arabic | Arabic SMS forces UCS-2: one part is **70 characters**, not 160. Assert copy against 70. |
| Arabic | Fold Arabic-Indic (U+0660) and Extended Arabic-Indic (U+06F0) digits to ASCII on every phone and OTP input |
| Arabic | Never derive a store URL slug from an Arabic store name without showing the merchant the result |
| Secrets | OTP codes stored as a **keyed HMAC**, domain-separated from other uses of the encryption key — a plain SHA-256 of six digits is not a hash, it is a lookup table |
| Privacy | `ip_hash` as unsalted SHA-256 **does not de-identify an IP** — the address space is small enough to brute-force. Salt it, or do not store it. |
| Config | Generate `.env.example` from a config registry rather than hand-editing it, so the template cannot omit a variable |
| Marketing | A Next.js marketing site could not hit the JS budget; it was ported to **Astro**. Start there. |
| i18n | Compare `ar.json` and `en.json` in a test — for months nothing did, and keys silently diverged |
| API | Every list endpoint needs a cursor **and a screen that sends it back** — one list silently showed the first 50 rows forever |
| API | Check that every referenced id (category, model, product) belongs to the caller's tenant, even when RLS would catch it — fail with a 404/422, not a leak |
| API | `PATCH` handlers that rebuild the row reset fields the caller never sent. Test partial updates explicitly. |

### 13.7 Process lessons

1. **Open external accounts before writing code.** This is the single biggest one. The
   build reached a state where almost nothing was buildable, with a healthy codebase.
2. **Do not cross a gate because the next phase is more interesting.** The first build
   opened P2 and P3 with P1's gate unpassed, and the result is a progress table that cannot
   answer "what works end to end?" — which is the only question that matters before launch.
3. **Split a package the moment it exceeds ~10 files or more than one bounded context.**
   Splitting early is healthy; half-building is not.
4. **Keep one state file, and update it every session.** A progress tracker nobody updates
   reports a third of the truth — this one did, for two days, more than once. Recount by
   deriving from the package list rather than incrementing by hand.
5. **Record every decision that would be expensive to reverse**, with the reason and the
   rollback, in one place. Re-litigating settled choices is the largest silent time sink in
   a long project.
6. **Found an unrelated bug? File it, do not fix it.** Drive-by refactors are how a
   166-package plan becomes a 400-package plan.

---

## 14. Working method and Definition of Done

### The session loop

1. **Orient** — read the state file, then the current phase's package file, then only the
   package you are about to do. Do not read the whole repo.
2. **Confirm scope** — in 3–5 lines: which package, what files you expect to touch, what
   "done" looks like. If it is bigger than one session, split it instead of half-building.
3. **Build** — follow the conventions. Small commits mid-package are fine.
4. **Verify** — see §13.4. Not optional.
5. **Record and close** — update the state file (done + date, next up, session-log line, any
   new decision or blocker), commit with the package ID in the message
   (`feat(P1.6): resumable product sync engine`), and write a short handoff paragraph.

### Hard rules

1. One work package per session.
2. Never skip a phase gate.
3. Never add a dependency without recording the reason and the rollback.
4. Never write a tenant-scoped query without a tenant filter. If you are reaching for
   `SET ROLE` or bypassing RLS, stop.
5. Never put a secret in the repo. Env vars, validated by a zod schema at boot.
6. Never mark a package done without running the verification.
7. Never add scope the package did not ask for.
8. Never change the data model without a migration **and** a rollback note in the same commit.
9. Never let the shopper-facing path hit Postgres directly.
10. Never build a native mobile app before P8.

### Definition of Done (every package)

- [ ] The deliverables exist and work
- [ ] Tenant isolation holds — verified by a test that attempts cross-tenant access and is denied
- [ ] Failure paths handled: external call fails, job fails, quota exceeded, permission denied
- [ ] Lint + typecheck clean for the changed scope
- [ ] Tests written and **executed**
- [ ] Migration has a rollback block, applied and reverted once locally
- [ ] Docs updated if behaviour or a contract changed
- [ ] State file updated, commit references the package ID

---

## 15. Anti-goals — deliberately not built

| Not building | Why | Revisit when |
|---|---|---|
| Native mobile apps | WebAR covers iOS + Android with no install friction | WebXR gaps make a feature impossible |
| Microservices | One API + one worker + one AI service is right at this scale | > 10 engineers |
| Kubernetes at launch | Docker Compose on one box is enough for stages 1–2 | Stage 3 (300+ merchants) |
| Dedicated vector DB | pgvector handles millions of vectors fine | > 50M vectors |
| Server-side try-on | Costs more than the revenue it enables | Never |
| Custom AR engine | `<model-viewer>` already solves iOS + Android + WebXR | Never |
| Own ZATCA implementation | Weeks of work and a compliance liability | Never |
| GraphQL | REST + OpenAPI + generated types is simpler here | Never |
| Multi-region active-active | Single region + CDN is plenty | GCC expansion demands it |

When someone — including you, at 2am — proposes one of these, the answer is in this table.

---

## 16. Timeline and team

### Pace

| Pace | Sessions/week | P0–P2 (first revenue) | P0–P5 (full product) | Everything |
|---|---|---|---|---|
| Part-time (~10 h/wk) | 4 | ~4 months | ~10 months | ~18 months |
| Full-time (~40 h/wk) | 12 | ~6 weeks | ~4 months | ~7 months |
| Full-time + 1 engineer | 20 | ~4 weeks | ~2.5 months | ~5 months |

**The milestone that matters is the P2 gate** — that is when the product can take money.
Everything before it is cost. Aim there first and resist the pull of the more interesting
later phases.

These estimates assume the external accounts in §12 already exist. They did not, in the
first attempt, and that is where the schedule went.

### Team

Immediate hires: senior full-stack engineer, AR/Three.js developer, AI engineer, UI/UX
designer, sales lead.

**Do not hire a mobile developer.** Build the web dashboard and WebAR first.

### Growth targets

| Phase | Timeframe | Goal |
|---|---|---|
| 1 | 60 days | MVP: multi-tenant auth, dashboard, Salla, sync, AR viewer — **10 paying stores** |
| 2 | 90 days | AI 3D generation, analytics, billing — **50 stores** |
| 3 | 120 days | AI comparison, recommendations, Zid — **200 stores** |
| 4 | 180 days | Virtual try-on, white-label APIs, enterprise — **500 stores** |

### End state (3 years)

1,000+ merchants · 50M+ product views · 500k+ AR sessions monthly · Saudi + GCC ·
Salla, Zid, Shopify, WooCommerce. At that point Tajribah is not an AR tool — it is the
infrastructure layer powering immersive commerce across the GCC.

---

## Appendix A — work package list

### P0 Foundation (20)

Monorepo scaffold · local dev environment · API skeleton · database layer ·
**tenancy core + RLS ⭐** · error model · dashboard app skeleton · design tokens + base UI
kit · authentication (password, refresh rotation, password reset) · email verification +
phone OTP + SMS adapter · RBAC · CI pipeline · **test harness + tenant-isolation suite ⭐** ·
config & secrets · observability (telemetry, tracing, Sentry) · storage adapter + R2/CDN ·
**job framework + queue fairness ⭐** · feature flags + entitlements · audit logging ·
staging deployment · dashboard API client + login + protected routes

### P1 Core loop (26)

Onboarding state machine · onboarding UI (wizard, sign-up, password reset, email
verification, 2FA) · **connector abstraction ⭐** (connection model + token vault, outbound
HTTP with timeout/retry/breaker/rate-limit) · Salla OAuth · Salla product mapping ·
**sync engine ⭐** (schema + partitioning, engine, job + transaction scope, schedule,
progress read path) · webhook ingestion (dedup constraint, signature + storage, handlers +
replay + delivery health) · products domain (schema, contract, repository/service/
controller) · products list UI · product detail UI · connections UI · manual 3D model
upload (tables + presigned upload + versioning, format validation, drag-and-drop uploader) ·
model processing pipeline (optimizer, process job, KTX2/Basis, GLB→USDZ) · model library
UI · **edge viewer config ⭐⭐** · **AR viewer widget ⭐⭐** · embed & install · shopper AR
experience · hosted AR pages · QR codes · AR settings UI · dashboard home · dashboard shell
(nav, tenant switcher, command palette, notification centre) · team management · settings ·
core-loop E2E test · viewer load test

### P2 Billing (15)

Plans & entitlements · usage metering · payment provider adapter ·
**subscription lifecycle ⭐** · **payment webhooks ⭐** · invoices & VAT · ZATCA
e-invoicing · dunning · AI credits ledger · billing UI · trial lifecycle · coupons ·
billing notifications · financial reporting · billing integrity tests

### P3 3D pipeline (12)

AI service skeleton (service, service-to-service auth, Pydantic contract mirror, tracing
across the language boundary, container image) · job orchestration (`ai_jobs` schema,
**lifecycle ⭐**, cancellation, progress for the UI) · photo intake & quality checks · 3D
generation adapter · **post-processing ⭐** · QA review queue · generation UI · 3D editor ·
batch generation · professional 3D service · cost tracking & margin guards · self-hosted
GPU path (conditional)

### P4 Analytics (12)

Event schema & browser SDK · edge collector · ClickHouse schema & rollups · metrics API ·
analytics UI · **conversion uplift ⭐** · return-rate reporting · exports & scheduled
reports · real-time activity · session explorer · analytics privacy & PDPL · analytics load
test

### P5 Try-on (14)

**Try-on engine core ⭐** · glasses · watch · ring · necklace & earring · handbag ·
**consent & privacy ⭐** · anchor calibration tool · quality scoring · configuration UI ·
shopper try-on experience · performance optimization · try-on analytics · try-on marketing
pages

### P6 AI + connectors (16)

Product embeddings · recommendation engine · recommendations UI · comparison engine ·
Arabic content enrichment · model registry & A/B · AI cost guardrails · AI jobs UI ·
**connector conformance suite ⭐** · Zid connector · Shopify connector · WooCommerce
connector · multi-store support · AI features marketing · recommendation quality
evaluation · connector health monitoring

### P7 Scale & hardening (13)

Load testing suite · database performance · caching strategy · CDN & asset delivery · rate
limiting & abuse protection · worker autoscaling & backpressure · security hardening ·
disaster recovery · KSA data residency migration · observability & SLOs · zero-downtime
deployment · cost optimization · capacity planning

### P8 Enterprise (12)

Public API v1 · API keys & scopes · outgoing webhooks · white-label branding · custom
domains · SSO/SAML · custom roles · partner & reseller program · enterprise contracts &
billing · GCC expansion · marketplace foundations · developer experience

### Track M — Marketing (12)

Site scaffold (Astro, i18n, tokens, SEO, consent + analytics gate, deployment) · home &
core pages · pricing (+ annual billing, ROI calculator) · Salla & Zid landing pages ·
product feature pages · industry solution pages · blog · help center · trust & social
proof · company & careers · legal pages · SEO & conversion optimization

### Track A — Admin (14)

Admin app & access control · platform overview · tenant management · tenant actions &
impersonation · user management · plans & pricing management · subscriptions & invoices ·
payments & revenue · AI operations · content & QA queues · platform operations · support
tooling · content management · compliance & system

---

## Appendix B — what the first build actually produced

Useful if you want to lift code rather than start empty. All of the following exists,
compiles and has tests that were run.

| Area | State |
|---|---|
| Monorepo, CI, config/secrets registry, structured logging, OpenTelemetry + Sentry | Working |
| Postgres schema + Drizzle + **RLS with the isolation suite** | Working, and hardened by a gate audit that found a live cross-tenant leak |
| Auth: argon2id, refresh rotation with reuse detection, password reset, email verification, phone OTP, RBAC | Working |
| Job framework, queue fairness, Bull Board | Working |
| Storage adapter (MinIO local / R2 production) | Working, R2 live |
| Feature flags, plan entitlements, `<PlanGate>` | Working |
| Connector abstraction + token vault + resilient outbound HTTP | Working |
| Sync engine (resumable, partitioned, per-connection schedule, progress) | Working, no live Salla credentials |
| Webhook ingestion: signature, dedup, dispatcher, replay, health | Working, no live provider |
| Products domain + catalogue UI (table, grid, detail, create/edit, bulk actions) | Working |
| 3D upload, format validation, versioning, optimizer (Draco/meshopt), model library UI | Working |
| Dashboard shell, tenant switcher, command palette, notifications, what's-new | Working |
| Billing: plans, entitlements, usage metering | Partial — everything else needs a payment account |
| AI service (FastAPI), job lifecycle, cancellation, progress, photo intake + quality checks | Partial, in progress |
| Marketing site (Astro): scaffold, SEO, consent, how-it-works, pricing | Partial |
| Edge worker, viewer widget, shopper AR, try-on, analytics, admin console | **Not started** — blocked on Cloudflare/domain |

**Carry over unchanged:** the page inventory, the data model, the RLS wiring, the isolation
test suite, and this document.
