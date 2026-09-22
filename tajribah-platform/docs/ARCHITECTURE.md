# Architecture — how the build plan maps onto this repo

The specification is `../../TAJRIBAH-BUILD-PLAN.md`. It assumes a pnpm/Turborepo monorepo
with NestJS, PostgreSQL + RLS, Redis/BullMQ, ClickHouse and Hetzner. **This repo runs the
same product on the stack that is actually available and already proven here** — the
vinext (Next.js 16 on Vite) + Cloudflare Workers starter used by `tajribah-try-on`.

Every difference is listed below with what it costs, what it buys, and how to get back to
the plan's shape. Nothing here is a silent substitution.

## The shape

```
tajribah-platform/            one deployable: Worker + Next 16 App Router
├── app/                      routes — (marketing) (auth) (onboarding) dashboard/ admin/ api/
├── components/               ui/ (shadcn, unchanged)  dashboard/  forms/  charts/
├── server/                   everything that runs server-side, no React
│   ├── core/                 tenancy · auth · rbac · errors · audit · idempotency · ratelimit
│   └── modules/<context>/    repository.ts (the only place SQL lives) · service.ts · dto.ts
├── db/                       Drizzle schema, migrations, seeds
├── lib/                      isomorphic: i18n, formatters, contracts (zod), utils
├── content/                  ar/en catalogues, legal texts
└── docs/                     this file, DECISIONS.md, PACKAGES.md
```

`server/modules/*` mirrors the plan's NestJS module list one-to-one
(`tenants users onboarding connections products models3d ar tryon ai-jobs billing
analytics support admin`) and keeps its rule: **controllers hold no business logic,
repositories are the only place SQL lives, and modules never import each other's
repositories.**

## Deviations from the plan

| Plan | Here | Why | Cost / return path |
|---|---|---|---|
| PostgreSQL 16 + RLS | **Same** (T9, which reverses T1). Tests run on PGlite, in process. | — | The production host and driver are not chosen yet; nothing registers a database outside the tests. |
| NestJS 11 on Fastify | Next route handlers + a service/repository layer | One runtime, one deploy, no second process to host. | Lose DI and interceptors; gain nothing to run. Module boundaries are enforced by convention and lint, not by the framework. |
| BullMQ + Redis | Cloudflare Queues + Cron Triggers, with a `jobs` table as the source of truth | No Redis to host. Job state already has to be queryable for the merchant UI. | Fair scheduling and backpressure must be written, not configured. Until the Cloudflare account exists, the queue runs in "inline" mode behind the same interface. |
| ClickHouse | `analytics_events` + rollup tables in Postgres, written from the edge | Keeps D5's rule (analytics never touches the transactional read path for merchants) while needing no extra store. | Fine to ~millions of rows, not to 2.5M/day. The event schema is ClickHouse-shaped from day one so the move is an exporter, not a rewrite. |
| Redis cache | Workers KV | Already a binding. Same 5-minute-plus-purge model as the plan's viewer config. | KV is eventually consistent — never read-after-write for anything a merchant just saved. |
| Monorepo (pnpm + Turborepo) | One app, folders instead of packages | pnpm is not installed on this machine and the plan's four frontends do not exist yet. | `lib/contracts`, `lib/i18n`, `server/connectors` are already written as self-contained folders with no upward imports, so extracting them into packages is a move, not a refactor. |
| argon2id | PBKDF2-HMAC-SHA-256, 600k iterations, via WebCrypto | Workers have no native argon2; the WASM build is a dependency and a cold-start cost. | Weaker per-guess cost. Recorded in DECISIONS.md as **must revisit before the first real merchant password**. The hash column stores its own algorithm prefix so a rehash-on-login upgrade needs no migration. |
| Marketing site in Astro | `tajribah-try-on` (already built, separate folder) | It exists, it is Arabic-first and it carries the live try-on demo. | Unchanged. This repo does not touch it. |

## How tenant isolation works

The plan's D1 decision — *isolation is enforced by the database, not by remembering a
`WHERE` clause* — is the one that cannot be dropped. It is enforced twice, and each layer
is tested on its own:

0. **Postgres RLS** (§7.1, `drizzle/0001_rls.sql`, generated). Merchant requests run as
   `tajribah_app` inside `withTenant()`, which sets `app.tenant_id` for one transaction.
   Work that precedes or spans a tenant — registration, login's membership lookup, the job
   queue — runs as `tajribah_admin` (BYPASSRLS) through `unsafeAdminDb()`, and that is
   exactly where the layers below carry the whole load.

1. **No repository takes a raw database handle.** Every tenant-scoped repository is
   constructed from a `TenantDb`, which is only obtainable from a verified
   `TenantContext` (session → membership → tenant).
2. **`TenantDb` injects the predicate.** `tdb.select(products)` compiles to
   `... WHERE tenant_id = ?` and `tdb.insert(products, row)` refuses a row whose
   `tenant_id` is missing or different. There is no method on `TenantDb` that returns an
   unscoped query.
3. **The unscoped handle is named to be noticeable.** `unsafeAdminDb()` lives in one file,
   is linted against everywhere else, and every call site must pass an explicit tenant
   filter plus a comment saying why it is admin work.
4. **The isolation suite is the gate.** `server/core/tenancy/__tests__/isolation.test.ts`
   walks every tenant-scoped table in the schema, seeds two tenants, and asserts that
   tenant A cannot read, write, update or delete a row of tenant B through the repository
   layer, the cache, the job payloads or the API. A new table with no isolation test fails
   the suite by omission — the walk is derived from the schema, not from a hand-written
   list. (§13.2: "isolation checks that name only the parent table will pass while a
   partition leaks" — the same trap, avoided the same way.)

Belt and braces is the intended end state, not one or the other. The suite breaks each
layer on its own: policies opened to `USING (true)`, the `TenantDb` predicate made a no-op,
the app role given BYPASSRLS — each turns it red.

## The two read paths (D3, unchanged)

```
Merchant  → Next route handler → service → repository → Postgres  (authenticated, low volume)
Shopper   → Worker route       → KV                               (anonymous, high volume)
                               → R2 via CDN for models
                               → event collector → buffered → analytics tables
```

The shopper path never touches the merchant database, and publishing AR settings writes Postgres
**and** enqueues a KV render keyed `cfg:{tenantId}:{productId}:{version}`. If the dashboard
is down, storefronts keep working. That property is why the widget can be embedded in other
people's shops.

## A merchant request, end to end (P0.18–P0.20)

```
app/api/**/route.ts        one line: export const POST = withBoot(handler)
  server/boot.ts           the only `cloudflare:workers` import; bootstrap() once per isolate
  route()                  request id in/out, access log, error hook → problem+json
  server/modules/*/http.ts the handler: readJson (zod → 422), assertSameOrigin, authenticate
  service → withTenant()   tenant data: RLS transaction (tajribah_app) + TenantDb predicate
          → audited*()     every tenant mutation: change + audit row, one transaction
```

Handlers are `(Request) => Response`, so they are tested in Node exactly as the Worker runs
them. `authenticate` loads the session behind every access token, so sign-out and theft
detection take effect immediately rather than at token expiry.

**Client side.** One set of screens (`components/pages`, mapped in `components/routes.tsx`)
renders in two shells that differ only in the environment underneath (`lib/app-env.tsx`):

| | Next app (`components/next-shell.tsx`) | Static preview (`preview/main.tsx`) |
|---|---|---|
| Routing | Next router, `app/[[...path]]/page.tsx` | hash router |
| Auth | `AuthProvider` + `ApiClient` | `DemoAuthProvider` (always signed in, says so) |
| Data | `apiSource` (real API; 501 where P1 has not built it) | `demoSource` (seeded) |

`ApiClient` keeps the access token in memory only; the refresh token is an httpOnly cookie
scoped to `/api/auth`. On a 401 it refreshes once — concurrent 401s share one refresh, since a
second would reuse a rotated token and trip theft detection. `Shell` wraps every screen in
`RequireSession`, which sends a signed-out visitor to `/login?next=…` (checked by `safeNext`).

## Conventions carried over unchanged

Screen IDs at the top of every page file (`// MD-010 — Products table view`), kebab-case
files, PascalCase components, snake_case plural tables, `t:{tenantId}:` on every cache key,
`domain.action` queue names, `domain.thing.past-tense` events, SCREAMING_SNAKE env vars
validated by zod at boot, money as integer minor units with an explicit currency, uuid v7
primary keys, `created_at`/`updated_at` on every table, and a `-- ROLLBACK:` block in every
migration.
