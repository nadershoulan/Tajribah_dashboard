# تجربة Tajribah — platform

The multi-tenant AR/AI commerce platform from `../../TAJRIBAH-BUILD-PLAN.md`, built on the
same stack as `../tajribah-try-on`: Next.js 16 (App Router) on vinext + Vite + Cloudflare
Workers, React 19, TypeScript, Tailwind v4, shadcn/ui, Drizzle on PostgreSQL with row-level security.

Arabic is the default language and RTL the default layout. **`../tajribah-try-on` is
finished work and is never modified from here.**

Start with [STATE.md](STATE.md) — what is done, what is next, what is blocked.

| | |
|---|---|
| [STATE.md](STATE.md) | Progress, blockers, session log. Updated every session. |
| [CLAUDE.md](CLAUDE.md) | Working rules. Read before changing anything. |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the plan maps onto this stack, and every deviation from it. |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisions that would be expensive to reverse (T1–T8). |
| [docs/PACKAGES.md](docs/PACKAGES.md) | The work packages and their definitions of done. |

## Where things live

- `db/schema/*` — 50 tables, split by area; `db/schema/index.ts` also exports the registry
  the isolation suite walks
- `server/core/*` — tenancy, auth, rbac, errors, jobs, rate limiting, billing entitlements,
  logging. Cross-cutting; features never import it sideways.
- `server/modules/<context>/` — one folder per bounded context; `repository.ts` is the only
  place SQL lives
- `server/worker/main.ts` — the worker **process** (it has an entry point, deliberately)
- `lib/*` — isomorphic: language, money, formatters, permissions, plans, view models
- `components/pages/*` — one component per screen, shared by the Next app and the preview
- `components/dashboard/*` — shell and UI kit
- `preview/*` — the static shell that renders the real screens without a server

## Running things on this machine

Node here is 20.15 with no pnpm; the app needs ≥22.13, so `npm run dev` and `next build`
**cannot run**. What does run, against an external toolkit (`<tk>`):

```sh
node scripts/test.mjs --modules <tk>/node_modules       # unit + isolation suites
node preview/build.mjs --modules <tk>/node_modules      # static preview -> dist-preview/
```

Type-checking uses a tsconfig scoped to the files this app actually uses, with `@types/*`
ahead of `node_modules/*` in `paths`. See CLAUDE.md.

## Demo data

`lib/demo-data.ts` is seeded data for the preview only, and the preview says so on every
screen. It uses Failet as an illustrative Saudi watch store — an example, not a customer.
Nothing in the product ships with invented numbers: a metric without data renders `—`.
