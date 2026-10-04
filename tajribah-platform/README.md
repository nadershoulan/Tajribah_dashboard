# تجربة Tajribah — platform

The merchant dashboard, the staff console, the API, the shop widget and the background work, from
`../../TAJRIBAH-BUILD-PLAN.md`. Next.js 16 (App Router) on vinext + Cloudflare Workers, React 19,
TypeScript, Tailwind v4, shadcn/ui, Drizzle on PostgreSQL 16 with row-level security. Arabic is the
default language and RTL the default layout.

The website and the try-on studio are here too (`site/`, `app/(site)`) since 2026-10-04; `../tajribah-try-on` is the old copy, kept only until it is deleted.

## Read first

| | |
|---|---|
| [docs/README.md](docs/README.md) | **Where to start reading** — which document answers what |
| [PROGRESS.md](PROGRESS.md) | Where the build is, in plain words. The top is always current. |
| [docs/RUNNING-LOCALLY.md](docs/RUNNING-LOCALLY.md) | Running it on your computer (no Docker) |
| [docs/HOSTING.md](docs/HOSTING.md) | Where it runs in production, and why |
| [CLAUDE.md](CLAUDE.md) | The rules every change follows |

## Where things live

- `app/` — routes: the dashboard's pages, the staff console, and `app/api/**` (each a one-line file pointing at a handler)
- `components/pages/*` — one component per screen, shared by the app and the static preview; `components/dashboard/*` — the shell and UI kit
- `server/core/*` — what everything relies on: tenancy, sign-in, roles, errors, jobs, storage, rate limits, plans, logging
- `server/modules/<area>/` — one folder per area (products, models, try-on, analytics, billing, connections, admin…): `http.ts` handlers, `service.ts` logic
- `server/connectors/*` — Salla, Zid, Shopify, WooCommerce
- `server/worker/*` — background work: the every-minute pass, the queue, the Node worker for images and 3D
- `db/schema/*` and `drizzle/*.sql` — the tables and every migration (each with its undo)
- `widget/` — the script shops paste, which draws the "view in your space / try it on" button
- `lib/*` — shared by browser and server: language, money, formats, permissions, plans, contracts
- `preview/*` — the static demo of every screen, with sample data and no server

## Checks

```sh
node scripts/test.mjs --modules node_modules     # every test (about 900)
pnpm lint && pnpm typecheck
```

GitHub runs the same on every push.

## Demo data

`lib/demo-data.ts` is sample data for the preview only, and the preview says so on every screen. It uses
Failet as an illustrative Saudi watch store — an example, not a customer. Nothing in the product ships
with invented numbers: a figure without data shows `—`.
