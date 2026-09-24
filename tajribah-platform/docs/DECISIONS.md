# Decision log

§13.7.5: *record every decision that would be expensive to reverse, with the reason and the
rollback, in one place.* Append here; never edit a decision in place — supersede it with a
new entry that names the one it replaces.

Format: **ID · date · decision · why · rollback cost and path.**

---

## Inherited from the build plan (not re-litigated)

| ID | Decision | Rollback |
|---|---|---|
| **D1** | One database, shared schema, `tenant_id` on every tenant-scoped table | Very expensive — the foundation |
| **D2** | Try-on inference runs in the shopper's browser, permanently | Never |
| **D3** | The shopper read path never touches the merchant database | Very expensive — a rebuild of the shopper path |
| **D4** | Cloudflare R2 for all 3D assets; column is `storage_key`, never `r2_key` | Low — swap the storage adapter |
| **D5** | Analytics events never enter the transactional merchant tables | Medium |

Anything in §15 of the plan (native apps, microservices, k8s at launch, a vector DB,
server-side try-on, a custom AR engine, own ZATCA, GraphQL, multi-region) is answered by
that table. The answer is no.

---

## T1 · 2026-09-22 · Cloudflare D1 (SQLite) instead of PostgreSQL 16 for the first phases

> **Superseded by T9 (same day).** Kept for the record; the code no longer targets D1.

**Why.** D1 is already a binding on this Worker; Postgres needs a host, PgBouncer and a
paid account that does not exist yet (§12 — the external accounts are the critical path,
and this is one of the few that can be avoided rather than waited on). Shipping P0 against
D1 keeps the schema, the repositories and the isolation suite moving while the accounts are
opened.

**What it costs.** No row-level security, no partitioning, no `pgvector`, no `numeric`,
weaker concurrency. Product embeddings (§7.6) and the analytics volume in §7.10 will not
fit D1 at scale.

**Rollback path.** The Drizzle schema is written once per dialect; repositories never write
raw SQL outside `repository.ts`; `TenantDb` is the only way to reach tenant data. Moving to
Postgres is: port the schema file, add the RLS policies from §7.1 underneath the existing
`TenantDb`, repoint the driver. Estimated days, not weeks — provided rule 3 in
ARCHITECTURE.md ("the unscoped handle is named to be noticeable") is never broken.

**Revisit when:** the first paying merchant, or 10k products in one tenant, or embeddings
are needed — whichever comes first.

## T2 · 2026-09-22 · One app, folders instead of a pnpm/Turborepo monorepo

**Why.** pnpm is not installed and Node here is 20.15 against the plan's ≥22.13; a monorepo
that cannot be installed is not a monorepo. Only one of the plan's four frontends is being
built in this phase (the dashboard); the marketing site already exists separately.

**Cost.** No enforced package boundaries — `packages/contracts` being load-bearing (§6)
becomes a convention instead of a compile error.

**Rollback path.** `lib/contracts`, `lib/i18n` and `server/connectors` have no imports that
point upward or sideways into app code. Extracting each into a package is a move plus a
`package.json`. Keep it that way: **an import from `lib/contracts` into anything is fine; an
import from anything into `lib/contracts` is a bug.**

## T3 · 2026-09-22 · PBKDF2-HMAC-SHA-256 (600k) instead of argon2id

**Why.** Workers have no native argon2id; the WASM build adds a dependency and cold-start
cost. PBKDF2 is available in WebCrypto with no dependency at all.

**Cost.** Materially weaker against GPU cracking than argon2id at equal wall time. This is a
real downgrade, not a wash.

**Rollback path.** Hashes are stored as `pbkdf2$sha256$600000$<salt>$<hash>` — algorithm,
parameters and salt inline. Verifying reads the prefix, so adding argon2id later means
supporting a second prefix and rehashing on next successful login. No migration, no
password reset.

**Revisit before:** the first real merchant password is stored. Until then every account is
seed data.

## T4 · 2026-09-22 · No new runtime dependencies beyond the starter's

**Why.** §14 hard rule 3. Everything P0 needs — password hashing, JWT signing, uuid v7,
random tokens, HMAC — is in WebCrypto. Auth libraries would each need a Workers-compatible
build and an audit.

**Cost.** ~200 lines of hand-written crypto glue in `server/core/auth/crypto.ts`, which must
be reviewed carefully once rather than trusted implicitly.

**Rollback path.** Each primitive is one exported function; swapping in a library is a
one-file change.

## T5 · 2026-09-22 · Money as integer minor units, not `numeric(12,2)`

**Why.** SQLite has no exact decimal type; `numeric` would silently become a float, which
§7.2 forbids outright.

**Cost.** Every read and write crosses a `halalas ↔ display` boundary. One formatter, one
parser, both in `lib/money.ts`; no arithmetic anywhere else.

**Rollback path.** On Postgres, `numeric(12,2)` with the same accessor functions. The column
name (`amount_minor`) says which it is, so a mixed state is visible.

## T6 · 2026-09-22 · Jobs are rows first, a queue second

**Why.** Merchants have to see sync and generation progress (§P1, §P3), so job state must be
queryable regardless of transport. Cloudflare Queues are not available until the account
exists (§12.2).

**Cost.** A row write per job transition.

**Rollback path.** `server/core/jobs/queue.ts` exposes `enqueue/claim/complete/fail` over an
interface with two implementations — `inline` (runs now, for local work) and `cf-queue`.
Swapping is a config value. §13.5's lesson applies: **the worker gets an entry point in the
same package as its first job**, not later.

## T7 · 2026-09-22 · Inline bilingual strings, not `ar.json` / `en.json`

**Why.** §13.6 records that `ar.json` and `en.json` silently diverged for months because nothing
compared them. Writing both languages at the point of use — `t('عربي', 'English')` — makes
divergence impossible by construction rather than caught by a test: there is no key to miss,
because there is no key.

**Cost.** Translators cannot work on a catalogue file, and the two languages sit inside the
component source. For data (plans, nav, legal text) the `Bi` object shape keeps them together
in the data file instead.

**Rollback path.** A codemod could lift every `t(a, b)` into two catalogues if a translation
vendor ever needs one. Until then, the test that would have been needed does not have to exist.

**Revisit when:** a third language is added, or translation moves outside the team.

## T8 · 2026-09-22 · sql.js (WASM SQLite) as a test-only dependency

> **Superseded by T9.** The harness uses PGlite; sql.js is no longer used.

**Why.** P0.6's isolation suite has to run real SQL against a real database — §5 is explicit
that isolation cannot be tested against a mock. `better-sqlite3` needs a native build this
machine cannot do, `node:sqlite` needs Node 22, and Testcontainers needs Docker. sql.js is
pure WASM and runs on Node 20.

**Cost.** One devDependency, used by `server/testing/harness.ts` and nothing else. It is not in
the runtime bundle and never reaches production, where D1 is the database.

**Rollback path.** The harness exposes `createTestDb()`; swapping the driver is one file. When
the project moves to Postgres (T1), the harness moves to Testcontainers and this goes away.

## T9 · 2026-09-22 · PostgreSQL + RLS as the plan says, with PGlite as the test database

Reverses T1 and T8. The schema, migrations and harness were moved to Postgres in a session
that did not record the switch; this entry records it after the fact.

**Why.** T1's reason was that Postgres needed Docker or a hosted account to test against.
PGlite (Postgres compiled to WASM, in process) removes that: the isolation suite runs real
Postgres with the real RLS migration on Node 20, no Docker. With that gone, the plan's own
design (§7.1) is cheaper than the workaround — two independent isolation layers (RLS
underneath, `TenantDb` on top) instead of one.

**Shape.** Two database roles, generated by `scripts/gen-rls.mjs` into `0001_rls.sql`:
`tajribah_app` (RLS applies; reached only through `withTenant`) and `tajribah_admin`
(BYPASSRLS; `unsafeAdminDb()`, for registration, login, the job queue — explicit tenant
filter on every query, §13.2). `db/client.ts` holds one handle per role.

**Cost.** `@electric-sql/pglite` as a **devDependency** only — used by
`server/testing/harness.ts`, never bundled. The production Postgres host and driver are
**not chosen yet**: nothing registers a database outside the tests. That is an open item in
STATE.md, not a decision.

**Rollback path.** The harness is one file; swapping PGlite for Testcontainers or a real
database changes `createTestDb()` and nothing else.

## T10 · 2026-09-23 · esbuild as a declared devDependency

**Why.** `scripts/test.mjs`, `scripts/gen-rls.mjs` and `scripts/gen-env-example.mjs` all
bundle TypeScript with esbuild. It had only ever been loaded from the scratch toolkit; the
first real project install (pnpm, strict layout) showed the project does not expose it, so
`verify.mjs` — the command CI will run — failed with "Cannot find module 'esbuild'".

**Cost.** A devDependency the toolchain already downloads (Vite/wrangler pull esbuild in);
0.28.2 is the version already in the store. Never bundled into the Worker.

**Rollback path.** Swap the three scripts to `vite build` / rolldown, or back to a toolkit.

## T11 · 2026-09-23 · Production Postgres on a Hetzner server (Nader's decision)

**Decision.** Postgres 16 on a Hetzner server, as the plan's hosting section assumed —
chosen over Neon and Supabase.

**Consequences.** The Worker cannot hold a Postgres TCP pool itself; the intended path is
Cloudflare **Hyperdrive** in front of the Hetzner database, with a driver that speaks to it
(to be chosen and recorded when wired — no dependency is added until then). Backups,
patching and failover are ours: the P7 disaster-recovery drill covers them. The two roles
from T9 (`tajribah_app`, `tajribah_admin`) become two login roles on that server.

**Blocks until the server exists:** sign-in in a browser (P0.20's last step), staging
(P0.22), and every P1 package that needs real persistence outside tests.

## T12 · 2026-09-23 · P1 starts before the full P0 gate passes — for account-free work only

**Decision (Nader's).** The P0 gate passed for code but not for infrastructure (no CI runner,
no staging; `docs/gates/P0.md`). Rather than wait, P1 packages that need **no external
account** may start: those whose only dependencies are this repo and the test database.

**Guard rails.** Salla/Zid/Cloudflare/Moyasar-dependent packages stay closed. Every P1
package still meets its own "done when", runs `verify.mjs`, and is seen to fail. The P0 gate
is re-run — and must pass — before P1's own gate. `STATE.md` lists the override at the top so
no later session mistakes it for a passed gate.

**Rollback path.** None needed: the work is additive and gated behind the same checks.


## T13 · 2026-09-23 · A forged webhook is refused and logged, never stored (P1.7)

**Context.** `webhook_events` carries `signature_valid`, and the schema comment said a
delivery that fails its signature is stored "for forensics". But `tenant_id` is NOT NULL, and
the only way to pick a tenant for a forged delivery is the store id *inside* it — chosen by
the forger.

**Decision.** Verify the signature over the raw body first. A delivery that fails is answered
401 and logged (provider, size); it is not written anywhere.

**Why.** Storing it would (a) let anyone fill any tenant's table by naming its store, and
(b) let a forger claim a real `provider_event_id` first, so the genuine delivery is later
dropped as a duplicate. Both are tested (`webhooks.test.ts`).

**Consequences.** `signature_valid` is always true today; it stays for providers whose secret
is per store (WooCommerce, P6), where the tenant has to be found before the signature can be
checked. Those rows must never occupy the dedup key of a genuine delivery — decide how when
that connector is built. Replay refuses `signature_valid = false` regardless.

**Rollback path.** Store refused deliveries in a separate, tenant-less platform table if
forensics are ever needed; do not put them back in `webhook_events`.
