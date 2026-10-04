# Tajribah platform — working rules

The product spec is `../../TAJRIBAH-BUILD-PLAN.md`. Read `STATE.md` first, then the current
package in `docs/PACKAGES.md`, then only the files that package touches. Do not read the
whole repo.

**The website (Track M) and the live try-on studio live here since 2026-10-04:** `site/` holds their
code (imported as `@site/…`) and `app/(site)` their pages, served by the same Worker (the website at
`/`, the dashboard at `/dashboard`). Track M work follows **`site/CLAUDE.md`** — improve in place,
never rewrite the studio, real photography only, invent nothing — and is recorded here in `STATE.md`
and `docs/PACKAGES.md` like any other package. The dashboard's code (`@/…`) and the website's
(`@site/…`) stay apart: the proxy gives each its own page policy (`lib/site-paths.ts`).
`../tajribah-try-on` is the old copy, frozen until Nader deletes it — never edit it.

## Hard rules (from §14, non-negotiable)

1. One work package per session. Never skip a phase gate.
2. Never write a tenant-scoped query without a tenant filter. If you are reaching for
   `unsafeAdminDb`, stop and read `docs/ARCHITECTURE.md` first.
3. Never add a dependency without an entry in `docs/DECISIONS.md` giving the reason and the
   rollback. The current answer is almost always "WebCrypto already does this" (T4).
4. Never put a secret in the repo. Env vars, validated by zod at boot.
5. Never mark a package done without running the verification. "Done" means *I ran it and
   watched it pass* — not "the code exists" (§13.4).
6. Never change the schema without a migration **and** a `-- ROLLBACK:` block in the same
   commit.
7. Never let the shopper-facing path read the merchant database (D3).
8. Never add scope a package did not ask for. Found an unrelated bug? File it in
   `STATE.md`, do not fix it.

## Tenancy — the thing that must never break

Two layers, both mandatory (ARCHITECTURE.md, DECISIONS T9): Postgres RLS underneath —
merchant work runs as `tajribah_app` inside `withTenant()` — and `TenantDb` on top, which
injects `tenant_id = ?` into every query and refuses a mismatched write. `unsafeAdminDb()` is
`tajribah_admin` and bypasses RLS: every query on it filters by tenant explicitly. After
adding a tenant-scoped table, re-run `scripts/gen-rls.mjs` and commit the regenerated
`0001_rls.sql` — never hand-edit it. Every new tenant-scoped table is picked up automatically by the
isolation suite because the suite walks the schema. If you add a table and the suite does
not mention it, the suite is broken — fix the walk, do not add an exception.

## Verification on this machine

**One command runs every automated gate check:**
`node scripts/verify.mjs --modules <toolkit>/node_modules --tsconfig <scoped tsconfig>`
(typecheck, all tests, `.env.example` freshness, RLS migration regeneration).

The system Node is 20.15, but a portable Node 22.23.2 + pnpm 11.25 (corepack) works from the
session scratchpad — recipe in STATE.md → "Local toolchain". With it, `node_modules` is a
real project install and `verify.mjs` also runs lint and the full typecheck; the dev server
runs on workerd. **API calls that touch the database fail in dev** (no Postgres host chosen) —
never report a browser sign-in as working. Without Node 22, what works:

- typecheck against the scratch toolkit with a `tsconfig` scoped to used files
  (`@types/*` must precede `node_modules/*` in `paths`, or React resolves to JS → TS7016);
- unit tests on pure modules (no Workers runtime needed);
- rendered screenshots of the static preview for UI.

Every check must be able to fail. When you add one, break the thing it checks and confirm
it goes red (§13.3). A green check nobody has seen fail is decoration.

## Conventions

- Screen ID at the top of every page file: `// MD-010 — Products table view`. That is how
  ~372 screens stay traceable; `grep -r "MD-0" app/` answers "what exists".
- kebab-case files · PascalCase components · `use` + camelCase hooks · snake_case plural
  tables · `t:{tenantId}:` on every cache key · `domain.action` queues ·
  `domain.thing.past-tense` events · SCREAMING_SNAKE env vars.
- `repository.ts` is the only place SQL lives. Controllers hold no business logic. Modules
  never import another module's repository — go through its service or an event.
- Money is integer minor units (`amount_minor`) plus a currency code. Never floats.

## Arabic-first (§11)

RTL is the default layout and Arabic the default language; English is the variant. Every
string is bilingual, every screen has both mirrors. **Numbers are ASCII in Arabic text too**
(`30 يومًا`, `15%`, `1.5`), matching the data beside them — Nader's decision 2026-09-23,
enforced by a test in `lib/__tests__/format.test.ts`. Arabic labels run 20–30% longer than
English — design for it. Never Arial for Arabic. Arabic SMS is **70 characters** per part,
not 160. Fold Arabic-Indic digits to ASCII on every phone and OTP input. Weekend is
Friday–Saturday; timezone Asia/Riyadh; VAT 15% shown separately.
