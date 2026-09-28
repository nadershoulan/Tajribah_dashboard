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

## T14 · 2026-09-24 · gltf-transform + meshoptimizer for model optimisation; meshopt, not Draco, for now (P1.13)

**Dependencies added** (runtime): `@gltf-transform/core`, `@gltf-transform/functions`,
`@gltf-transform/extensions` 4.5.0 and `meshoptimizer` 1.2.0 — all MIT, all older than the
workspace's 7-day release-age policy.

**Why.** The plan names `gltf-transform` for post-processing (§5). WebCrypto-style "the
platform already does this" does not apply: there is no glTF reader, mesh optimiser or
meshopt encoder in the runtime. meshoptimizer is WASM, so it runs in Node and in Workers.

**Meshopt, not Draco.** Both are in the plan. One compressor per file (`model_files.compression`
is one value), and `<model-viewer>` decodes both. Meshopt was chosen first because it also
compresses animation and morph targets, decodes faster on low-end phones, and needs no second
WASM encoder (`draco3dgltf`). Draco usually compresses dense static meshes further — if the
size report (`withinTarget`) shows models missing 2 MB because of geometry, add Draco as a
second optimised variant rather than replacing meshopt.

**Not solved here (P1.13b).** Texture compression (KTX2/Basis) and GLB→USDZ need native
encoders (`toktx`, Blender or `usd-core`) in the worker's container. Textures pass through
untouched until then, and they are usually most of the 2 MB.

**Rollback path.** Remove the four packages and `server/modules/models/{optimize,process}.ts`;
confirmed uploads then stay `processing`, and nothing else depends on them.

## T15 · 2026-09-25 · The storefront widget is a small loader; `<model-viewer>` loads on tap; iOS 15+ (P1.16)

**Decision.** The script on merchants' product pages (`widget/`) only finds its placeholders,
fetches and checks the viewer config from the edge, and draws the button in a shadow root —
2.7 KB gzipped today, gated at 60 KB by a test. `<model-viewer>` (the plan's viewer, §5) is
loaded by a module script tag **only when a shopper taps**, from a pinned, versioned URL on
our CDN (`data-tajribah-viewer` overrides it for tests). Build target `es2020`: iOS 15+,
because esbuild will not lower destructuring around a Safari 14 bug, and Saudi iPhone
traffic below iOS 15 is negligible.

**Why.** `<model-viewer>` with three.js is several times the 60 KB budget; bundling it would
put that weight on every product page view for the few shoppers who tap. Loading it by script
tag keeps the loader import-free and lets the viewer be updated without touching the loader.

**Consequences.** The pinned `model-viewer` file must be copied onto our CDN when Cloudflare
exists (P1.15/P1.18); until then the default URL does not resolve and a tap fails closed
(nothing opens). A failed viewer load currently gives the shopper no feedback — P1.18 adds
the native fallbacks (Quick Look link, Scene Viewer intent).

**Rollback path.** Bundle the viewer into the widget and raise the budget — a deliberate,
measured trade, not a default.

## T16 · 2026-09-26 · `ENCRYPTION_KEY` rotates with a key id and one previous key (fix filed under P1.3)

**Decision.** Token envelopes are `v2.<key id>.<iv>.<ciphertext>`. The key id is 8 characters
of an HMAC under the key in its own domain (`encryptionKeyId`) — never a prefix of
SHA-256(key), which is the AES key itself. An optional `ENCRYPTION_KEY_PREVIOUS` opens
envelopes the old key sealed; `v1` envelopes (no key id) are tried against both. Tokens move
to the current key when used (`accessTokenFor`, under its row lock) and by a sweep on the
worker's schedule tick (`server/modules/connections/rotation.ts`).

**Procedure.** Set `ENCRYPTION_KEY_PREVIOUS` = old, `ENCRYPTION_KEY` = new, deploy. Wait for
the worker log `connection tokens re-sealed` to stop reporting any (`resealed: 0` — the sweep
is silent then). Remove `ENCRYPTION_KEY_PREVIOUS`, deploy. Rows counted `unreadable` were
already unreadable; their next use asks the merchant to reconnect, as before.

**Why.** Without a key id, changing the key made every connection unreadable at once, and
every merchant had to reconnect — which rules out rotating after a suspected leak. One
previous key, not a keyring: rotations are rare, and each finishes in minutes.

**Rollback path.** Put the old key back as `ENCRYPTION_KEY` with the new one as previous; the
same sweep moves everything back. Code rollback: `v2` envelopes would need re-sealing as `v1`
first — drop the key id segment (`v1.<iv>.<ciphertext>` opens under the same key).

## T17 · 2026-09-26 · Two-step sign-in: TOTP, a stateless challenge, the password again for changes (P1.2b)

**Decision.** Authenticator apps (RFC 6238: SHA-1, 30 s, 6 digits, ±1 step) on WebCrypto, no
new dependency (`server/core/auth/totp.ts`, checked against the RFC's test vectors). The secret
is sealed like store tokens (AES-GCM under `ENCRYPTION_KEY`, bound to `totp:{userId}`) and
re-sealed by the rotation sweep (T16). A code is accepted once: `users.totp_last_step`
(`drizzle/0005`) is written only if the step is newer, in the checking statement. Ten backup
codes (`xxxx-xxxx`, ~40 bits), stored as keyed hashes, removed on use by compare-and-swap.

Sign-in: a correct password on a two-step account returns a **stateless challenge** —
`userId.exp.MAC(userId, exp, password hash)`, five minutes — instead of a session; API-011
exchanges it plus a code for the session. The failure count is not reset at the password
step, so wrong codes reach the same lockout as wrong passwords. Turning it on or off and new
backup codes need the password again; every on/off is emailed to the account holder.

**Why.** TOTP needs no account and works offline — SMS (AUTH-13) waits on Unifonic and is the
weaker factor anyway. A stateless challenge needs no table and dies by itself (expiry) or with
a password change (the MAC covers the hash). Re-asking the password means a stolen access
token cannot switch the protection off, or turn it on to lock the owner out.

**Rollback path.** Disable per user (`totp_enabled = false`, the three columns nulled) and the
password alone signs in again. Code rollback: `login()` returning a challenge is the only
behaviour change for existing accounts, and only for those with it on; migration 0005 has its
`-- ROLLBACK:`.

## T18 · 2026-09-26 · Later phases open for account-free work before the P1 gate (extends T12)

**Decision (Nader's, 2026-09-26: "start work in a later phase that needs no account").** Every
account-free P1 package is built; everything left in P1 needs Salla, Cloudflare, the domain or
a decision. Rather than idle, packages of **later phases whose "Needs" column is empty** may
start, in spine order: P2 first (Billing), then the parallel tracks as the plan allows (Track A
after P2.1).

**Guard rails.** Same as T12: a 🔒 package may be prepared but is never marked done without its
real service; every package meets its own "done when", runs `verify.mjs`, and is seen to fail.
The P0 gate re-run and the P1 gate still come first before any phase gate is claimed —
`STATE.md` keeps both overrides at the top.

**Rollback path.** None needed: the work is additive and behind the same checks.

## T19 · 2026-09-26 · A plan change applies to every subscriber at once — no grandfathering

**Decision (Nader's: "move to the new ones").** When a plan's price, limits or features change,
existing subscribers move to the new terms; nobody keeps the terms they signed up under. This
is how P2.1 already behaves: `entitlementsOf` reads the plan's rows on every request.

**Consequences.** No plan versioning, no per-subscription snapshot of limits. A change that
*lowers* a limit can leave a store over it: nothing is deleted — the next create is refused
with the limit named, as for any full store. A price change takes effect from the next billing
period (P2.4 decides the exact moment, with Moyasar). Tell merchants before a change that
takes something away; that is a message, not a code path.

**Rollback path.** Put the old values back in the rows. If grandfathering is ever wanted,
add a `plan_version` to `subscriptions` and read limits through it.

## T20 · 2026-09-26 · SRO Company is the seller; invoices number per store per year (P2.6)

**Decision.** Nader supplied the operating company: **SRO Company** (شركة إس أر أو), one-person
LLC, Ministry of Commerce unified national number **7033242079** (used as the CR number). It
lives in `server/core/billing/seller.ts`, reviewed like code, and is snapshotted onto every
invoice. **Its VAT number is not known yet.** The documents supplied with the CR (an SNB IBAN
letter) show 300002471110003, which is **Saudi National Bank's** VAT number; it is recorded
here only so nobody uses it. Until SRO's own TRN is set, `issueInvoice` refuses.

Numbers: gapless per store per Riyadh year, as §7.4 rule 3 asks, allocated by one upsert on
`invoice_sequences` inside the invoice transaction. The number carries the store
(`TJ-2026-A1B2C3D4-000001`, the last 8 characters of the tenant id — stable, unlike the slug)
so `invoice_number` stays unique across stores.

**Why.** An invoice without the seller's own VAT number is not a tax invoice, and a wrong one
is worse than none. ZATCA's own gapless counter (ICV) and hash chain run per e-invoicing unit
on the seller's side, which the certified provider operates (P2.7); the store-level sequence is
the merchant-facing number.

**Rollback path.** The seller constant and the number format are code; issued invoices keep
their snapshot and number whatever changes later.

**Update 2026-09-27 — SRO Company's own registration supplied.** ZATCA VAT registration
certificate no. 100261166069860 (TIN 3145505117): VAT number **314550511700003**, registration
**effective 2026-02-01**, quarterly returns. National Address proof no. 1081828547: building
7169, Prince Muhammad Ibn Saad Ibn Abdulaziz Rd, Al Malqa Dist., Riyadh, postal code **13524**,
secondary number 2369, short address RRMA7169. The VAT certificate prints postal code 13525;
the National Address record is the authority for an address, so 13524 is used — worth
correcting with ZATCA so the two agree. Consequences: invoices can now be issued; the seller's
address is snapshotted in Arabic and English (`drizzle/0013`); **no invoice is dated before the
registration took effect** (midnight 1 Feb 2026 in Riyadh), because VAT may not be charged
before it — the certificate says so. The address is kept structured for ZATCA Phase 2 (P2.7).

## T21 · 2026-09-26 · A table created after 0001 carries its own generated RLS block (P2.12)

**Decision.** `scripts/gen-rls.mjs` reads which migration creates each schema table. Tables
from `0000_init` stay in `0001_rls.sql` (byte-identical to before). A table created by a later
migration gets the same policy and grants written **into that migration**, between
`-- rls:begin` and `-- rls:end`, plus the admin role's grant (0001's `ON ALL TABLES` only
reached tables that existed then). `verify.mjs` now regenerates and compares every migration,
not only 0001. First use: `drizzle/0010_coupons.sql`.

**Why.** 0001 runs before a later table exists, so its policy cannot live there; and editing an
applied migration is how a database drifts from its files. The isolation suite walks the schema
and was seen to catch a later table with RLS removed (3 failures).

**Rollback path.** Revert the generator; a later table's `DROP TABLE` removes its block's effects.

## T22 · 2026-09-27 · Privacy requests and retention — working rules (A14)

**Decision (Nader: "do invent").** Nothing defined these, so these are Tajribah's working rules
until counsel reviews them. They follow the Saudi PDPL's shape; the periods are ours.

**Privacy requests** (`data_requests`):
- **Who.** A person with a Tajribah account, about their own account data (Tajribah is the
  controller). Shoppers: Tajribah holds no shopper identity — analytics sessions are a daily
  salted hash, try-on runs on the device — so a shopper request is answered "no personal data
  held" (rejected with that reason), and pointed to the store, which is the controller for its
  own customers.
- **How it arrives.** To support (email or phone); staff record it in the console with the
  subject's email and how identity was checked. The person asks from the address on the account,
  or support confirms by a call — never on an unverified message.
- **Deadline.** 30 days from receipt (the PDPL response period); the console shows what is due
  and overdue.
- **Export.** One JSON file: the profile (no password hash, no two-step secret, no backup
  codes), stores and roles, sessions (when, which device — the IP stays hashed and is not
  included), notifications, and what they did (action, record, time, field names). Kept as a
  private snapshot; staff send it.
- **Erasure.** Refused while the person owns a store (transfer or close it first — the store's
  data is the store's, not only theirs). Otherwise the account is anonymised (email, name,
  phone, password, two-step cleared; `deleted_at` set), memberships removed, sessions ended,
  their notifications and pending invitations deleted. Audit rows stay, pointing at the
  anonymised account: the record of what was done is kept, not who did it.
- Every step (recorded, exported, erased, rejected) is in the staff trail with a reason.

**Retention** (a daily sweep, admin role — the role that keeps DML for exactly this):

| Data | Kept for | Then |
|---|---|---|
| Raw analytics events | 90 days (as the schema already states) | deleted; daily rollups kept |
| Ended sessions (revoked or expired) | 90 days after they ended | deleted, with their refresh tokens |
| Used or expired one-time tokens | 7 days | deleted |
| Read notifications | 180 days after reading | deleted; unread ones 1 year |
| Webhook deliveries | processed / ignored 30 days; failed 90 days | deleted |
| Finished jobs | done / cancelled 30 days; dead 90 days | deleted |
| Store activity trail (`audit_logs`) | 3 years | deleted |
| Staff trail (`staff_audit`) | 5 years | deleted |
| Invoices, AI credit ledger, coupon uses | not swept (VAT records ≥ 6 years; the ledger *is* the balance) | — |
| Deleted stores | listed for review after 90 days; never purged automatically | a person decides (purging would delete invoices) |

**Rollback path.** The periods are one table in code (`server/modules/admin/retention.ts`);
changing one changes the next sweep. Nothing deleted can be brought back — lengthen a period
before a sweep, not after.

## T23 · 2026-09-27 · "Platform copy" (A13) means announcements

**Decision (Nader: "do invent", applied to A13's undefined "platform copy").** All product copy
stays in code, reviewed like code — a label or a legal sentence is not something to change
without review. The one kind of copy that must change on staff's schedule rather than a
release's is a **notice to every store**: a maintenance window, a new feature, holiday support
hours. That is what A13's platform copy is: **announcements** (`drizzle/0015`), bilingual and
required in both languages, shown on every dashboard between a start and an end (at most 90
days apart), `info` or `warning`, optionally linking inside the dashboard only. A platform
catalogue: the app role reads, only the admin console writes; each change is in the staff trail
with a reason. A store can dismiss one (remembered in that browser only).

**Rollback path.** Switch an announcement off; drop the table with 0015's ROLLBACK.

## T24 · 2026-09-27 · Cancelling a running AI job keeps its charge

**Decision (Nader's, 2026-09-27: "I'd rather charge for a running job").** A merchant can cancel
an AI job at any time and the status changes at once. **Before the job starts, the credits come
back.** **Once the provider is working on it, the credits are kept** — that work was paid for.
Failed jobs are still always refunded (the failure is ours, not the merchant's). A result that
arrives after a cancel is thrown away, and what the provider charged is still recorded in
`actual_cost_cents`.

The refund follows the state the job was really in: `cancelAiJob` tries `queued → cancelled`
first and only then `processing → cancelled`, each a conditional update, so a worker starting
the job at the same instant cannot turn a refunded cancel into a charged one or the reverse.

**Rollback path.** One line in `cancelAiJob` (`if (was === 'queued') await giveBack(...)`).

## T25 · 2026-09-28 · Generated models are reviewed by a person before they can go live

**Decision (from the plan's own P3 gate: "20 real products generated, QA-approved").** A model
made by generation (`source: ai_generated`) cannot be published until Tajribah staff approve it
in the model review queue (P3.6 / A10). Every new version starts the review over. A rejection
must say what is wrong; the merchant reads that note and is notified either way. **A merchant's
own upload is not held**: it is their file, and a review they did not ask for would only slow them.
Models made by the professional service are Tajribah's own work and are shown as such.

**Rollback path.** The gate is one check in `publishVersion`; removing it lets generated models
publish on the merchant's word. Review state and history stay as recorded.

## T26 · 2026-09-28 · P5 ships watches first, with the owner's studio loaded unchanged

**Decision (Nader's, 2026-09-28: "Watches first" and "Load it unchanged").** The plan orders
try-on glasses → watches; the engine that exists and is proven is the owner's wrist studio
(`tajribah-try-on/components/studio/Studio.tsx`). P5 therefore starts by bringing **that studio**
to merchants' product pages, and glasses (a new face-tracking engine) come after.

The studio is not rewritten or re-implemented. The one change is additive: `Studio` takes an
optional `product` (`TryOnProduct` in `lib/demo-product.ts`) and defaults to `DEMO_WATCH`, so the
site demo is unchanged — proven byte-identical (the studio's HTML and its canvas pixels, model and
compare modes, Arabic and English, before and after). A merchant's watch brings its own cut-out
photos, case width and names; `demo: false` hides the Failet badge and note. Nothing in the
try-on repo's rule 1 list moved.

**How it reaches a shop:** the storefront script opens the studio, as it is, in a frame on
Tajribah's own domain over the product page — isolated from the shop's CSS and scripts, with the
camera and QR pairing working as they do on the site.

**Rollback path.** Drop the `product` prop (the default is the old behaviour) and the frame.

## T27 · 2026-09-28 · Try-on privacy: a notice, not a gate; unpicked QR photos swept every minute

**Decision (Nader's, 2026-09-28: "Add a scheduled sweep").** The site promises a QR-transferred
photo is "deleted when received, or after 30 minutes". Expired sessions were only removed when
someone opened one or started a new one, so with no traffic an unreceived photo stayed. A
scheduled job (`worker/index.ts` → `lib/pair-sweep.ts`) now removes every expired session and its
photo, and any photo older than a session whose session is gone. It runs **every minute**, so the
30-minute promise holds to the minute; each run is two R2 listings. The pairing routes and the
capture page are unchanged — the sweep calls the pairing's own `removeSession`.

**No blocking consent screen.** The studio never opens a live camera (`getUserMedia` is not used):
a photo comes through the phone's own picker or camera app, which asks the shopper itself, and the
studio already says the photo stays in the browser. A gate would add a step without guarding
anything, and would mean changing the owner's studio. Instead the try-on frame's bar says "Your
photos are processed on your device" and links to the camera & photo privacy page. If a live
camera mode is ever added, a consent step comes with it.

**Rollback path.** `main` back to `vinext/server/fetch-handler` and drop `triggers` in
`vite.config.ts`; remove the `.embed-privacy` link.

## T28 · 2026-09-28 · A watch picture's empty edges are cropped automatically; size problems warn, not block

**Why.** The owner's studio draws a cut-out's **full width as the case width** (compare mode:
`caseMm × 4.3 px`; model mode: poses tuned to the demo's tightly cropped pictures). A merchant's
picture with empty space at its sides would therefore show the watch smaller than it is, quietly
breaking "true to size". The studio is not changed (rule 1); the pictures are made to fit it.

**Decision.** After each confirmed upload, a background check (`tryon.quality`) crops away edges
where nothing is visible (alpha below ~3%) and stores the cropped copy in place of the upload.
It is lossless — PNG stays PNG, WebP is re-encoded lossless and `exact` — and the test compares
every pixel. The crop is audited as a system change and the merchant is told ("we cropped away
the empty edges"). What cropping cannot fix — a soft shadow or glow that widens the picture but
not the watch — is **measured and shown**, with the share of real size it costs and how to fix
it. It does **not** stop the merchant switching try-on on: the number is theirs to act on, and a
threshold that blocks would be a business rule nobody has set. If Nader wants a floor (for
example, no switch-on below 97%), it is one condition in `updateTryOn`.

**Rollback path.** Drop the `enqueueQuality` call in `confirmCutout`; the column stays null and
the screen shows nothing for it.

## T29 · 2026-09-28 · The website lives on tajribah.sa; services stay on tajribah.com

**Decision (Nader's, 2026-09-28: "Website on tajribah.sa").** The website — and so the try-on
frame, which is one of its pages (`/embed/try-on`) — is served from **tajribah.sa**, as the site
already assumed (`lib/site.ts`). The dashboard's services keep their hosts on **tajribah.com**:
published configs (`cfg.`), files (`cdn.`), events (`ev.`). The widget's default try-on address is
now `https://tajribah.sa/embed/try-on` (a shop can still override it with `data-tajribah-tryon`).

**Rollback path.** One constant in `widget/src/tryon.ts`.

## T30 · 2026-09-28 · A person's second store starts on its own 14-day trial

**Decision (Nader's, 2026-09-28: "Its own 14-day trial").** Adding a store from the dashboard
(the store list at the top) creates it exactly as sign-up does — its own 14-day free trial,
starting at the setup's store step — with the person as its owner. Because each new store is a
new free trial, two guards: the person's email address must be confirmed, and a person can add
at most 5 stores a day. A staff member's read-only view of a store cannot add one.

**Rollback path.** Remove `POST /api/auth/stores` and the form; `createTrialStore` stays as
sign-up's helper.

## T31 · 2026-09-28 · The studio draws once its first view's pictures are in

**Decision (Nader's, 2026-09-28: "Yes, load them when picked").** The studio used to wait for all
seven of its pictures before drawing. It now loads the wrist photo and the watch first and draws;
the lifestyle photo, the flat product shot and the reference objects load right after (not only
on the tap, so they are usually in before a shopper picks them — if not, that view shows the
studio's own loader until they are). Once loaded, every view renders exactly as before — checked
to the byte. The embed page preloads only the first two.

**What it bought, measured:** on a slow network the watch is on screen ~0.4 s sooner; on a good
one, no change — there the wait is the page's code starting on the phone.

**Rollback path.** The image effect and the `assetsReady` line in `Studio.tsx`, and
`studioImages` in `lib/tryon-config.ts`.

## T32 · 2026-09-28 · The website leads to self-service sign-up at app.tajribah.sa

**Decision (Nader's, 2026-09-28).** "Start with this plan" on the website's pricing page opens the
dashboard's sign-up with the plan (`https://app.tajribah.sa/register?plan=…`); Enterprise keeps
"Talk to sales". The merchant dashboard lives on **app.tajribah.sa**. The Starter plan's Arabic
name is **«البداية»** in both apps.

Because the free trial runs on Starter's features, the sign-up page says so when another plan
was chosen, and points to Billing for the move — it never implies the trial is on that plan.

The website and the dashboard are separate projects, so a dashboard test imports the website's
settings and reads its pages: the install lines, the script address, the sign-up link and the
plans' names must match, or the test fails.

**Rollback path.** Pricing's link back to `/contact`; `NEXT_PUBLIC_APP_URL` for another address.

## T33 · 2026-09-28 · Every plan gets the studio; "on me" is Pro; analytics as the dashboard has it

**Decision (Nader's, 2026-09-28).** The website's pricing table is right about the try-on, the
dashboard is right about analytics:
- **Every plan** sets its watches up for the owner's studio: shoppers try the watch **on the model**
  and **compare its size** (`size_comparison`, now on Starter too). **On me** — the shopper's own
  photo (`virtual_tryon`) — is Pro and Enterprise; for other shops the studio does not show that
  tab (an optional `onMe` on the product; the published config carries it, only `true` counts).
- **Analytics:** basic on Starter, full from Growth; the website's table says so.

The studio's modes are a protected item; this change was made on Nader's answer, as an option
that defaults to all three modes — the demo renders identically, checked to the pixel.

**Rollback path.** Restore the `virtual_tryon` check in `tryon/service.ts`; drop 0020.

## T34 · 2026-09-28 · Unbuilt features are shown as coming, never sold as included

**Decision (Nader's, 2026-09-28: "Mark it coming soon").** "AI product comparison" (Growth and up
on the pricing page) is not built — it is the plan's P6 comparison engine, which needs an AI
provider. Until it exists, the pricing table and the Growth card say "coming soon", and a test
stops it being shown as a plain tick. When it ships, the cells become ticks and the test changes
with it.

## T35 · 2026-09-28 · The trial runs on Growth; plan features are enforced where they are used

**Decision (Nader's, 2026-09-28).** The 14-day free trial gives **Growth**'s features — catalogue
sync included — so the setup's "connect your store" step and sign-up's promise hold; after the trial
the store picks a plan. And every plan feature the catalogue lists is **enforced where it is used**:
- store platforms — connecting and every sync (Salla and Zid from Growth, Shopify and WooCommerce
  from Pro); a store whose plan no longer has its platform stops syncing, quietly;
- AI 3D work (`ai_3d`, Pro and up) and product embeddings (`recommendations`, Pro and up), refused
  before anything is charged;
- analytics: basic on Starter (totals, daily chart, devices); full from Growth (conversion reports,
  the funnel, top products, export).

A trial store also gets Growth's monthly AI credits (40), because credits follow the plan.

**Rollback path.** `TRIAL_PLAN` back to `'starter'`; each check is one line at its call site.
