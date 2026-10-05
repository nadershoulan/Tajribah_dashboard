# Decision log

§13.7.5: *record every decision that would be expensive to reverse, with the reason and the
rollback, in one place.* Append here; never edit a decision in place — supersede it with a
new entry that names the one it replaces.

Format: **ID · date · decision · why · rollback cost and path.**

## At a glance — what is in force (2026-10-04)

The log below is history, oldest first. This table is the short version of what holds today.

| | In force |
|---|---|
| **Stack** | Two apps on Cloudflare Workers (vinext / Next 16): the dashboard + API here, the website + try-on in `../tajribah-try-on` (T2, ARCHITECTURE.md) |
| **Database** | PostgreSQL 16 with row-level security (T9 — replaced T1's D1 and T8's sql.js); production on a Hetzner server (T11), reached through Hyperdrive with `pg` and two logins (T60) |
| **Background work** | A `jobs` table, Cloudflare Queues + a minute cron; image and 3D work on a Node worker (T6, T57) |
| **Passwords** | PBKDF2-SHA-256, 600k rounds — **revisit before the first real merchant password** (T3) |
| **Money** | Integer minor units (halalas) with a currency (T5); a plan change applies to every subscriber at once (T19); SRO Company is the seller (T20) |
| **Domains** | Website and try-on on tajribah.sa, dashboard on app.tajribah.sa, services on tajribah.com (T29) |
| **Plans** | Every plan has the studio; "on me" is Pro and up (T33); the trial runs on Growth (T35); unbuilt features shown as coming or not at all (T34, T39) |
| **Try-on** | Watches first with the owner's studio unchanged (T26), then glasses, rings, necklaces and bags with real licensed photos and measured scale (T68) |
| **3D** | gltf-transform + meshopt (T14); the iPhone file made in TypeScript (T65); a generation costs 10 credits (T55); generated models reviewed by a person (T25) |
| **Store platforms** | Salla and Zid built from their public documentation, confirmed once the apps are registered (T61); Shopify and WooCommerce built, a Shopify erasure removes access but keeps the catalogue (T58) |
| **Privacy** | Retention and privacy requests (T22); shop analytics anonymous, 90 days (T64, ANALYTICS-PRIVACY.md); website analytics GA4 behind consent (T68) |
| **Professional models** | Price list 349 / 649 / 1,149 SAR; paid by bank transfer until card payments open (T66, T68) |
| **Gates** | Account-free work of every phase may be built before its gate (T12, T18, T56); gates themselves still pass only with the real accounts |

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
no staging; the P0 gate report, since removed — in git history). Rather than wait, P1 packages that need **no external
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

## P1.15 · 2026-09-29 · Publishing a viewer config: explicit, then kept true

**Decision.** Publishing is the merchant's act ("Publish to the store", `ar:publish`) — a saved
label or placement does not reach shoppers until then. After that, what shoppers see is **kept
true** without asking: a product that no longer qualifies (archived, deleted, AR off with no try-on,
the store suspended) is withdrawn at once, and a change made elsewhere that alters the published
config (try-on switched off, a new model version, the store's button colour, a sync) is written. A
withdrawn product that qualifies again is published again — the merchant published it and never
took that back. A product never published is never published by a refresh.

**Why.** A live button that opens a deleted picture or a store's suspended catalogue is worse than
no button; and asking the merchant to re-publish every product after changing the brand colour is
busywork.

**Also decided (in-plan detail).**
- The config store sits behind `ConfigStore`; production is Cloudflare KV (the plan's choice),
  memory locally. No KV before the account exists.
- A watch with try-on and **no 3D model** gets a config (`model: null`) — T33 gave every plan the
  studio, and many watches will never have a model. The widget accepts `model: null` only with a
  valid try-on block on the wrist.
- The config's colour defaults to `#00A7BC`, the aqua the dashboard's preview already showed.
- Cached for 60 s at the host (a change reaches shoppers within about a minute, plus KV's own
  propagation).

**Known gap — closed by T36 (2026-09-29).** A replaced cut-out's old picture was deleted right after
the live config was rewritten; a shopper holding the previous config could meet a missing picture.
Now a live product's replaced picture is deleted 10 minutes later.

**Rollback path.** Remove the Publish handler; configs already in KV stay until deleted by key.

## T39 · 2026-09-29 · Unplanned features are removed from the website, not marked "coming"

Applying T34 (nothing unbuilt is sold as included) to three claims that are also **not in the
plan** — stock sync, add-to-cart inside the studio, a studio preview in the dashboard. T34 marked
"AI product comparison" as *coming soon* because Nader chose that for a planned feature; for an
unplanned one, "coming" would invent a roadmap, so the claim is removed. If Nader wants either
feature, it goes into the plan first and the website can then say it is coming.

## T40 · 2026-09-29 · Removing is the merchant's; withdrawing is the system's

Two ways a live button leaves a shop, kept apart on purpose:
- **Withdrawn** (the system, P1.15): the product stopped qualifying — archived, nothing to open, the
  store suspended. The key is kept; when it qualifies again it is published again.
- **Removed** (the merchant, or the store uninstalling our app): the key is cleared; only publishing
  again brings it back.

An app uninstall removes the buttons of that connection's products (the website's Salla FAQ says
they disappear at once). A dashboard **Disconnect** does not: it stops syncing, and its confirmation
says the products and their models stay.

## T55 · 2026-09-29 · A 3D generation costs 10 credits; buttons stay after a trial or subscription ends

**Credits (Nader: "make it").** One 3D generation from photos costs **10 AI credits**
(`lib/ai-credits.ts`, enforced by `createAiJob`). It is the most expensive work credits pay for, so
text work (Arabic content enrichment, available on every plan's credits) can later cost 1 without
being priced like a model. On Pro's 200 monthly credits that is 20 new 3D models a month; the
monthly allowances stay plan rows the admin console can change. The website states the same number,
and a test keeps it equal.

**Buttons (Nader: "they stay").** When a trial ends unpaid or a subscription is cancelled, the store
goes read-only in the dashboard but its published buttons **stay on its shop**. Only a suspended or
closed store's buttons are taken down (P1.15).

## T56 · 2026-09-29 · Account-free packages of later phases may be built now

**Decision (Nader: "continue build the plan — the ones that do not need setup").** While the P1 gate
waits on the accounts, packages from later phases (P6, P7, P8) that need no account, provider or
setup may be built, as T18 allowed for Track A. The gates themselves are unchanged: none is marked
passed, and P7's load tests and DR drill still need staging.

## P6.7 · 2026-09-29 · AI spend guardrails start with no limit

The guardrails (pause a kind of AI work, a platform daily spend cap, a per-store daily job cap) are
built with **every limit unset**: a cap is a business number — what Tajribah is willing to spend on
providers in a day, how much AI one store may use — and none has been given. Staff set them on the
admin console's AI page; each change needs a reason and is written to the staff trail with its
before and after. Two behaviours are deliberate: **zero is a cap** (it stops all new AI work — the
"off" switch), and the spend cap stops *new* work only — cost is recorded as attempts end, so work
already sent can carry a day past the cap.

## P8 · 2026-09-29 · An API key acts as its maker, narrowed to its scopes

A key belongs to the store but **acts as the person who made it**, within the scopes ticked: the
request context is built for the maker (membership, role, suspension, read-only state — every
rule a person meets) and then narrowed. So a key never outlives its maker's place in the store,
never exceeds their current role, and cannot write in a read-only store. The alternative — keys
as independent store identities — would need its own role, its own suspension rules and a way to
outlive the people who made it; for a store's own integrations that is more power than asked.
Two consequences, deliberate: **revoking stays possible while a store is read-only** (a leaked key
cannot wait for a payment; making a new one can), and keys hold **only** product, model, AR,
try-on and analytics scopes — money, people, settings, other keys and deleting the store stay
with a person signed in.

## P8 · 2026-09-29 · Custom roles cover the work, never the keys to the store

A custom role (Enterprise) may combine product, model, AR, try-on and analytics permissions, and
seeing connections, the team and settings. It may **not** hold inviting or managing people,
changing settings, billing, API keys, store connections or deleting the store: those stay with the
built-in owner and admin. With that line, a custom role can never be used to promote oneself or
anyone else, and the ranking rules for built-in roles stay whole. Giving someone a custom role sets
their built-in role to **viewer** underneath, so a store that leaves the plan falls back to the
least access, never to whatever the person held before.

## T57 · 2026-09-30 · Background work: Cloudflare runs the queue; image and model work need Node

**Found:** nothing ran background jobs in production — the dashboard Worker had only vinext's
fetch handler; `server/worker/main.ts` was called by nothing, and `JOBS_MODE=cf-queue` named a
consumer that did not exist. Every sync, publish, retry and sweep would have waited for ever.

**Decision.** The dashboard Worker gets its own entry (`server/worker/entry.ts`, wrapping vinext as
the website already does): an **every-minute cron** runs the sweeps and drains the queue, and a
**Cloudflare Queue consumer** drains it when a new job's nudge arrives, so work starts in seconds
and consumers are added as messages pile up, up to `max_concurrency` (the database's protection).
Jobs stay rows (T6): a message carries no work, so a lost one costs at most a minute. Each pass
drains within a **time budget** — no batch starts past it, none is cut short — and the rest waits
for the next pass. Each sweep runs on its own, so one failure does not stop the others.

**Consequence.** `sharp` (model optimisation, try-on picture checks) is native and cannot load in a
Worker — one import and the whole Worker fails at start-up (seen in workerd). So the Worker
registers only the Workers-safe handlers and claims only their queues; `ai.postprocess` and
`tryon.quality` wait for a **Node worker** (`runForever`), which needs a Node host that reaches the
database — naturally the database server (open with the Hetzner decision). A test walks the
Worker's imports and fails on any path to `sharp`.

**Rollback path.** Drop the queue binding and set nothing else: the cron alone still runs
everything within a minute. Moving image work onto Workers later (a WASM decoder) needs only its
handlers moved into `handlers-edge.ts` — the import test says whether they are safe.

## T58 · 2026-09-30 · A Shopify shop's erasure erases its access; its imported catalogue stays

Shopify requires every listed app to answer three privacy webhooks. **Customers:** the app is only
ever granted `read_products`, so Shopify never gives it customer data — a customer's request for
their data, or for its erasure, finds nothing held, and is recorded as handled. **Shop erasure**
(`shop/redact`, 48 hours after an uninstall): what Tajribah received from Shopify is the shop's
access and its catalogue. The access (the stored token) is erased and the connection revoked; its
buttons leave the shop. **The imported products stay**: they are now the merchant's own catalogue in
their Tajribah account — with the 3D models and try-on settings built on them — which they keep
using, and can delete, themselves.

**Revisit (Nader):** if Shopify's review, or your reading of the rules, wants the imported products
gone too, the handler (`privacy.shop_redact` in `server/modules/webhooks/dispatch.ts`) can archive or
delete that connection's products — a small change.

## T59 · 2026-09-30 · Single sign-on: from the store's address, members only, one store per session

Enterprise stores sign their people in with their own OpenID Connect provider. Four choices, each
the safer of two:

- **Sign-in starts from the store's address** (`/login/sso?store=…`), not from an email domain. With
  domain routing, any store could list someone else's domain and send their staff to its provider's
  page; domain ownership checks would be needed to stop it. By address, no claim is needed.
- **Members only; no account is made on the fly.** The provider's word adds nobody: the store invites
  people first, and a first sign-in links the provider's identity to the member with that verified
  address. (Creating accounts at first sign-in is a later choice, if stores ask.)
- **An SSO session opens its store and nothing else.** A person may belong to several stores and have
  their own password and two-step sign-in. Whoever runs one store's provider vouches for that store
  only — so the session is locked to it, and account-wide actions (another store, two-step settings,
  invitations, the staff console) need the person's own sign-in. A test makes every future endpoint
  that authenticates by itself choose.
- **Password sign-in stays on.** Requiring SSO for a store's members (turning passwords off for them)
  is a later option; today SSO is an additional way in.

OIDC only for now. SAML (still asked for by some older corporate setups) would be a second protocol
behind the same rules; Entra, Google Workspace and Okta all speak OIDC.

## T60 · 2026-09-30 · The database connection: `pg` through Hyperdrive, two logins, a connection per unit of work

T9 left the production driver open; the host is still Nader's choice (Hetzner), but the connection code
does not depend on it, and without it the app could not run anywhere but the tests.

- **Driver: node-postgres (`pg`)**, through **Hyperdrive** on Cloudflare — the pairing Cloudflare
  documents for Workers (`nodejs_compat`), and what Drizzle supports as `drizzle-orm/node-postgres`.
- **Two logins**, one per role: `tajribah_app` members (RLS applies) and a `BYPASSRLS` login in
  `tajribah_admin` (the attribute is not inherited). Not one login with `SET ROLE`: Hyperdrive pools
  by transaction, so session settings do not survive — the reason tenancy is transaction-local too.
- **A connection per role per unit of work** — each request (`route`) and each background pass — opened
  on first use and ended when it settles (`withDbConnection`). A Worker may not use a connection opened
  for another request; Hyperdrive keeps the real ones warm. One connection per role, as the tests'
  single PGlite: a query outside its transaction waits visibly rather than running without the
  store's setting.
- **Migrations by `scripts/db/migrate.mjs`** — psql only, a ledger with each file's sha-256, applied
  before the code that needs them (they are expand-only).

**Tried:** the whole app in workerd on a local Postgres 16 — sign-up, sign-in through the browser,
RLS-bound writes, isolation between stores (`docs/DATABASE.md`).

**Rollback path.** `db/postgres.ts` is the only file that knows the driver; `postgres.js` would be a
drop-in. A long-lived Node worker (`runForever`) registers its own pools with `registerDb` instead.

**Update 2026-09-30 (T57) — the Node worker exists and was run.** `server/worker/node.ts` (built and
started by `scripts/worker-node.mjs`) registers only `ai.postprocess` and `tryon.quality`, keeps its own
database pools, and runs no sweeps. It reaches the bucket through the S3 API — `S3Storage`
(`STORAGE_PROVIDER=s3`, SigV4 in the headers, checked against the AWS documentation's example), R2's S3
endpoint in production. Run on this machine with the dashboard in workerd, PostgreSQL 16 and SeaweedFS
(an S3 server that checks every signature): a real 8.97 MB model was uploaded through the dashboard,
optimised by the Node worker in about 4 seconds to 509 KB (web) and 975 KB (native), and marked ready.

## T61 · 2026-09-30 · Four answers from Nader

**Decisions (Nader's, 2026-09-30):**
- **CI on GitHub Actions — yes.** `.github/workflows/checks.yml`: the platform runs `scripts/verify.mjs`
  (typecheck, tests, `.env.example`, RLS, lint) and the website its typecheck, on every push and pull
  request, on the account's Actions minutes.
- **The try-on studio's three accessibility gaps may be fixed — only those three,** without changing
  how it looks or works: names for the two sliders, the tab link to a missing panel, and the faint
  text (the same deeper shade as the rest of the site).
- **White-label (Enterprise): the store's own logo and name** replace Tajribah's in the two places
  shoppers see it — the phone page a QR code opens, and the try-on page's title. The store owner's
  dashboard is unchanged.
- **Salla and Zid connectors — build both now** from their public API documentation, tested against
  faithful stand-ins as Shopify's was; a real store confirms or corrects the details once the partner
  accounts exist.

**T61 update (2026-09-30) — how white-label reaches the phone page.** The studio starts a QR pairing
with a bare `POST /api/pair`; rather than change its code, the pairing reads which store it belongs
to from the request's same-origin Referer (the try-on frame's own address) and then reads the brand
from Tajribah's config host for that store and product. The brand is never taken from the request,
so a forged Referer can only show a real store's own published name and logo. Any doubt (another
page, another site, no brand, the host unreachable) → Tajribah's, as before; the pairing still works.

**T61 update (2026-09-30) — Salla, from its public documentation: what is taken on trust.** Built from
docs.salla.dev and tested against a stand-in that answers as those pages show. Four details the pages
do not settle, each chosen so a real store proves or corrects it (the conformance suite runs unchanged
against one):
1. **Listing order** — not documented. Paging holds under edits if it is by id; the stand-in orders by id.
2. **Time zone of `updated_at`** ("2022-05-26 09:45:09", no zone) — read as Saudi time (UTC+3), as
   Salla stamps its webhook times.
3. **A product with no price** — the pages always show one; the stand-in holds a missing price as 0.
4. **Page format** — the general pages show `currentPage/totalPages/total`, the products page
   `current/next`; both are read.
Also: Salla sends no event id with a webhook, so a delivery is identified by its event, store, product
and time stamp; and the store's tokens inside `app.store.authorize` are never stored with the event.

**T61 update (2026-09-30) — linking a Salla store.** Salla allows published apps only its "easy mode":
the store's tokens arrive by webhook on install, with nothing that says which Tajribah account the store
belongs to. Linking takes proof from each side: the tokens are Salla's (the webhook signature) and wait
sealed in `store_grants`; the store is Salla's word (its introspect answer for the session token it gives
our app page inside its dashboard); the account is the merchant's own sign-in, spending a 10-minute
ticket. That page is the only one of ours another site may frame, and only Salla's dashboard. Two answers
from Salla's real servers differ from its documentation (introspect refuses with 422, not 401; unknown
app keys get 401 `invalid_client`) — the second is now a setup fault, never a reason to disconnect stores.
Salla's Embedded SDK is vendored (not added as a package: the app's packages are shared with another
working copy and carry no lockfile).

**T61 update (2026-09-30) — Zid, from its public documentation: what is taken on trust.** Built from
docs.zid.sa and tested against a stand-in; Zid's real servers were asked how they refuse. To confirm on
a real store (the conformance suite runs unchanged against one):
1. **Page size** — the docs give no maximum; 50 is asked for.
2. **Unpublished products** — the list is asked without `is_published`, whose documented default is
   `true`; whether unpublished products are then listed.
3. **A product with no price** — the pages always show one; the stand-in holds a missing price as 0.
4. **A refused refresh token** — no real answer was seen (it needs a real app); anything but Zid's
   "Client authentication failed" is read as the store's access ending.

**T61 update (2026-10-01) — connecting a Zid store.** Zid's App Activation & OAuth Policy decides the
shape: OAuth starts the moment the merchant presses Activate in Zid (no Tajribah sign-in first); the
`state` is one-time, short-lived and bound to the browser that started it (a signed nonce matched
against an HttpOnly cookie); the code is exchanged at the callback and the store identified from Zid's
own answer; account linking comes after, with the merchant's own session — the same waiting access and
10-minute ticket as Salla, now shared code. A reinstall renews the linked store instead of adding one.
Zid signs no webhook, so each subscription carries its own Basic-auth credentials: the store and event as
the username, our keyed hash of it as the password — checkable without storing anything, and useless for
any other store or event. Zid's uninstall notice (an app-level webhook, shape unpublished) waits for a
real app; meanwhile a refused request revokes the connection.

## T62 · 2026-10-01 · P8: agency accounts and custom domains; the website's wording stays

**Decisions (Nader's, 2026-10-01):**
- **Agency accounts — build now:** one agency login manages its clients' stores (switching, and an
  overview of all of them). No commissions or reseller pricing — those stay Nader's to set later.
- **Custom domains — build now:** an Enterprise store's AR and try-on pages on its own address (like
  `ar.theirstore.com`); the verification is built now, switching it on needs Cloudflare.
- **GCC stores and the partner program: not now.**
- **The website keeps saying Salla and Zid are coming** until a real Salla or Zid store has connected.


## T63 · 2026-10-01 · P4.8: the weekly summary by email — the defaults

The plan names "exports & scheduled reports" and says nothing more. These are the defaults built —
**mine, not Nader's; each is one constant or one rule to change**:

- **Opt-in, per member.** Nobody is emailed unasked: each member switches it on for themselves, per
  store, on the Analytics screen. (The alternative — the owner switching it on for the whole team —
  sends recurring mail to people who never asked.)
- **Weekly, Sunday 08:00 Riyadh, covering Sunday to Saturday** — the Saudi working week. One cadence
  only; no daily or monthly option until someone asks for one.
- **Who may:** the people who may export (`analytics:export`: owner, admin, analyst), on a plan with
  full analytics (T35 already puts reports there), with a **confirmed email address**. Checked again
  every week; a read-only store (trial or subscription ended) gets none.
- **What it says:** the week's totals from the daily rollup beside the week before, and the conversion
  uplift only when both groups are large enough. A quiet week is sent as zeros (a missing mail would
  read as a fault). Plain text, in the member's language.
- **Once:** a week is claimed before it is sent; an email that fails is logged and not sent again.

## T64 · 2026-10-01 · P4: the analytics write side is built here; how visits are counted

**Decision (Nader, 2026-10-01):** the read-side session builds the write side (P4.2 collector, P4.3
roll-ups, then P4.9–P4.11); the two-session split of 2026-09-27 ends. The other session had written
no code for it.

**Defaults built (mine; each one constant or one clause):**
- **A visit** is one tab's token in one store on one Riyadh day (hashed with all three). An **AR or
  try-on session** is a visit opening it on a product (taps on the same product count once) — the
  figure the plan's "AR sessions per month" meters.
- **Conversion** per product: visits that saw the product, split by whether they opened AR or the
  try-on on it; *bought* = a purchase of that product, or a purchase reported without a product (a
  whole order).
- **Revenue** counts purchases in riyals or with no currency; another currency is a purchase that
  adds no riyals (no conversion by a guessed rate).
- **Robots** (crawlers, headless browsers, command-line tools) are not stored.
- **Roll-ups** run per store per day at most every 5 minutes; days older than 85 are never recomputed
  (raw events go at 90).
- **Limits** (from the agreed P4.2 table): 60 batches a minute per store and visitor, 1,200 a minute
  per store (counted per Worker instance — Workers KV takes one write per key per second).
- **Live view and visit paths** are full analytics (Growth and up, with the trial), like the other
  reports (T35).

## T65 · 2026-10-02 · P1.13b: the iPhone file is made in TypeScript — no tool in the worker's image

**Decision (engineering, within P1.13b).** The open question was which native tool to put in the
worker's image (Blender, or `usd-core` + a converter) to turn the plain GLB into a USDZ. Neither is
needed: `server/modules/models/usdz.ts` writes the scene as a USD text layer with UsdPreviewSurface
materials — the layer Quick Look reads, and what three.js's exporter writes for `<model-viewer>`'s own
Quick Look — and packs it as Pixar's USDZ requires (stored, 64-byte aligned, the layer first). It runs
wherever the processing job runs, from the `native` document the optimiser already makes. No new
dependency (gltf-transform was already there).

**How it was checked.** The Khronos WaterBottle (CC0) converted and judged by Pixar's own
`UsdUtils.ComplianceChecker(arkit=True)` (usd-core 24.11, the shader definitions the Windows wheel omits
supplied from OpenUSD v24.11): 0 errors, 0 failed checks, 0 warnings, every shader judged; a
deliberately misaligned and a compressed repack of the same files both fail it. Its vertices, through
USD's own transform, equal the GLB's to the micrometre (the GLB's node turns it 180°). Rendered beside
the GLB with three.js: the same materials.

**Not carried** (product models in a room do not need them): texture transforms, vertex colours,
animation, skins, morph targets, points and lines. **Texture compression (KTX2)** stays out: P3.5's
WebP already brings real models under the 2 MB target. **Not seen** on an iPhone (none here): the
first real check is a published model opened from a shop page on an iPhone (GO-LIVE).

**Rollback path.** Remove the `toUsdz` call in `process.ts`; the model files simply have no USDZ again
and iPhones use the in-page viewer, as before.

## T66 · 2026-10-02 · P3.10: professional 3D models — asked and quoted in the dashboard; paying waits for the gateway

**Decision (engineering default, yours to change).** The website already sells "Professional 3D
modelling — priced per product" (with refund terms: fully refundable before work starts), but the
dashboard had no way to order it. Built up to the payment step, the way the billing screen is:
a merchant asks for one product's model from its page (with a note); staff see every request in the
console (**Professional models**), oldest first, with the product's measurements and reference photos,
and send a price in riyals before VAT plus a note; the merchant is told and sees price, 15% VAT and
total; they may cancel before work starts. **Accept and pay** is shown but closed until the payment
gateway (Moyasar) is connected — so nothing is charged and no work is committed before payment, which
keeps the website's refund terms true. One open order per product (a partial unique index).

**What is yours to decide** (none blocks this): the prices themselves (staff type them per product),
whether to publish a price list, and the delivery time to promise.

**Rollback path.** Remove the panel from the product page and the console page; the table
(`professional_orders`, migration 0037) can stay empty.

## T67 · 2026-10-03 · Recommendations, first version: "often viewed together", from real visits — no AI

**Decision (Nader's, 2026-10-03: "Recommendations, no AI").** Every account-free package being built,
the next step chosen was recommendations without an AI provider. Nightly per store, from the analytics
events the collector already keeps: two products are related by the visits that looked at both — a
product view, AR or the try-on, in one visit — over the last 30 days. Each product keeps its top four,
and only pairs at least three visits share. The merchant sees them on the product page (every plan);
on Pro and up (`recommendations`) the product's own page (P1.19) shows them to shoppers as "Often viewed
together", linking only to products that are live with their page on.

**What it is not.** Not AI and not sold as AI: the website's Pro line "AI recommendations and
comparisons (coming soon)" stays as it is; the plan's embeddings (P6.1–P6.3) still need a provider.
Not on the shop's own product page yet (that is the storefront script, which would carry the list in
its config — a later step).

**Rollback path.** Remove the pass from `server/worker/passes.ts` and the `related` field from the
config; the tables (0038) can stay.

## T68 · 2026-10-03 · Your open questions, decided by me as you asked ("you choose, as real as possible, Saudi audience")

Each choice is a working default you can change; each says why.

- **Privacy wording** — the analytics session's proposal (docs/ANALYTICS-PRIVACY.md) applied to the
  website's policy as written: shop-page events per visit for 90 days, no IP or browser identifiers,
  a visit id that changes daily and per shop. Date moved to 3 October 2026. The note that the legal
  pages await Saudi-licensed counsel stays.
- **Professional model prices** (before 15% VAT), from Saudi freelance and studio rates for product
  3D models: **Simple** 349 SAR (a box, a bottle, a bag without hardware) · **Standard** 649 SAR (a
  watch, glasses, a shoe, a piece of furniture) · **Detailed** 1,149 SAR (jewellery, polished metal,
  stones, fine hardware). Two rounds of changes included; 5 working days (Detailed: 7). Staff pick a
  tier or type another price; the website says "from 349 SAR".
- **Before card payments open** — the usual Saudi B2B route: the merchant accepts the quote in the
  dashboard; our team sends payment details and an invoice by email (bank transfer); staff mark the
  payment received with its reference; only then does work start; the finished model is delivered
  into the product by staff and the merchant is told. No bank details are written into the product:
  they are a business fact Nader supplies (Invent nothing).
- **Partner and reseller terms** (drafts, published on the website marked as such until counsel
  reviews): **Referral partners** earn 20% of the subscription payments of stores they refer, for the
  stores' first 12 months, paid monthly in SAR by bank transfer once the store's payment is 30 days
  old. **Agencies** managing 5 or more stores get 20% off plan prices for those stores, billed to the
  agency. Applications by email; commission tracking arrives with card payments.
- **Site analytics** — **Google Analytics 4**, the standard in Saudi e-commerce, with **Consent Mode
  v2**: nothing is measured until the visitor accepts in an Arabic-first banner (PDPL: consent for
  non-essential cookies); a choice can be changed from the footer. Live once a GA4 measurement id is
  set (`NEXT_PUBLIC_GA_ID`); without it there is no banner and nothing loads.
- **Calibration tool** — built in the **dashboard, not in the studio**: on the try-on settings page
  the merchant drags two markers to the case's left and right edges on their uploaded picture; the
  picture is cropped so its full width is exactly the case (what the studio already assumes, P5.9).
  The studio is not touched.
- **New try-on types** — real photographs only, under licences that allow commercial use without
  permission (Unsplash, Pexels, Wikimedia CC0/public domain), each recorded in ASSETS.md with its
  source and licence. Never drawn.

**Rollback path.** Each item is its own change; revert it alone.

## T69 · 2026-10-04 · GA4 set up from the dashboard, with "Sign in with Google" (you asked)

**Decision.** A GA4 measurement id is set on a screen, not in a build variable:
- **The website's id** — staff console → **Website** (`/admin/site`). Saved with a reason in the staff
  trail and published to the config host (`/v1/_site/settings.json`); the website reads it at run time
  (at most once a minute, keeping the last answer if the host is unreachable). `NEXT_PUBLIC_GA_ID`
  stays only as the fallback. The banner, the page policy and the policy wording follow the live id.
- **A store's own id** — Store settings → **Google Analytics**. Published in each product's config;
  the product's own page (`/p/…`) shows a banner naming the store and loads the store's GA4 only after
  the shopper agrees — the choice kept per store. Consent Mode v2 and ads denied, as on the website.
- **On the shop itself** nothing is set: the widget hands its moments (`ar_open`, `ar_place`,
  `tryon_start`, `tryon_capture`, as `tajribah_…` events) to the `gtag` or Tag Manager `dataLayer`
  the shop already runs, under the shop's own consent settings — and only events our own tracker
  accepted (Do Not Track and the shop's consent switch hold).
- **Picking with Google** — both screens can paste the id, or sign in with Google (OAuth code flow,
  `analytics.readonly`, online access) to list the person's GA4 web streams and pick one. Nothing of
  Google's is kept: the token is used once at the callback and dropped; the list comes back in a
  signed ten-minute ticket that opens only for the person (and store) who started it. The button
  appears once `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` are set (a Google Cloud OAuth client — steps
  in HOSTING.md); until then ids are pasted.

**Why.** You asked to set it from the dashboard with a Google sign-in, for the website and for stores.
A store's shoppers on its own product page are the store's (the store is the controller), so its id,
its banner, its choice — never Tajribah's website id there, and never the other way round.

**Changed from T68.** Product pages could load no analytics at all; now they may load the store's own,
behind its banner. Their page policy therefore allows Google Analytics' hosts on `/p/…` (the script
still arrives only through the page's own code).

**No new dependency** (OAuth and the Analytics Admin API are two HTTPS calls; WebCrypto signs the state
and the ticket). **Schema:** `drizzle/0041_analytics_settings.sql` — a `site_settings` table (admin
role only) and `tenant_settings.ga4_measurement_id`, with its ROLLBACK.

**Rollback path.** Revert the commit and run the migration's ROLLBACK; the website falls back to
`NEXT_PUBLIC_GA_ID` and product pages to no analytics. Cost: low.

## T70 · 2026-10-04 · The website moves into the platform — one app, one Worker (you asked)

**Decision.** The website and the try-on studio (`tajribah-try-on`) now live in the platform, so the
old folder can be deleted:
- **Code** in `site/` (components, lib, content, hooks, preview, its `CLAUDE.md` and `ASSETS.md`),
  copied unchanged except for its imports (`@/…` → `@site/…`, a tsconfig alias; the test runner
  resolves it too). The studio is byte-for-byte the owner's (`site/CLAUDE.md` rule 1).
- **Pages** in the route group `app/(site)` with their own root layout and stylesheet
  (`site/styles/`); the dashboard's moved to `app/(app)`, its catch-all from `[[...path]]` to
  `[...path]` so `/` is the website's home. vinext builds one stylesheet per root layout, so neither
  side's styles (or the dashboard's dark theme) reach the other — checked on the built app.
- **Page policies stay separate**: the proxy gives the website's pages (`lib/site-paths.ts`, checked
  against the folders by a test) the website's policy and every other page the dashboard's; the
  website's pages may use the camera on this origin (`Permissions-Policy`), the dashboard's never.
- **One Worker**: the platform's entry gains the website's store-address redirect (T62) and the QR
  photo sweep (P5.7). The pairing API is `app/api/pair` — the one API route outside the module map.
- **Shopper photos get their own private bucket, `PAIR_BUCKET`.** On the website, `BUCKET` held only
  those photos; in the platform `BUCKET` is the merchants' public CDN storage, where a shopper's photo
  must never be.
- **Links**: sign-up and sign-in are same-site now (`COMPANY.appUrl` defaults to empty); the developer
  page shows the API on the site's own full address.

**Why.** You asked for one project. Two Workers, two deploys and two copies of the shared pieces (the
plans, the hosted page reader, the security policy) were drift waiting to happen; the platform's
tests already imported the website's files across folders.

**No new dependency** (the platform already had every package the website uses, at the same versions).
**No schema change.** The old folder stays, marked frozen, until you delete it; CI's platform job no
longer installs it.

**Rollback path.** Revert the commit: the platform goes back to the dashboard alone and the old folder
is still there, unchanged, with its own Worker setup (`tajribah-try-on/vite.config.ts`). Cost: low
until the old folder is deleted; after that, restore it from git history.

## T71 · 2026-10-04 · Products without linking a store: a feed's link or a file, like Google Merchant Center (you asked)

**Decision.** Store connections gains "Without linking your store: from a link or a file":
- **A link to a product file** — the Google Merchant feed a store's platform publishes (Salla has apps that
  generate one; Zid, Shopify and WooCommerce plugins do too). Read once to check it, then synced like a
  linked store: now, and every 24 hours. A new provider, `feed` (migration 0043, with its ROLLBACK note),
  whose connector (`server/connectors/feed`) fetches the whole feed under the install check's rules
  (https, public name, no private address on any redirect, 30 s, 30 MB) and pages through it. The link
  is sealed like a token — Salla's carries a secret.
- **A file from the computer** — CSV, TSV, Excel (.xlsx) or Merchant XML, up to 30 MB. Read in the
  upload's own request and synced there; **the file is never stored** (the merchants' bucket is public,
  and there is no reason to keep it). One "file" connection per store: uploading again updates the same
  products and archives the ones the new file no longer has. Never re-read on a schedule; "sync now" is
  refused for it ("upload the file again").
- **Reading** (`lib/product-feed.ts`): Google's attributes (id, title, description, link, image_link,
  additional_image_link, price, item_group_id, mpn/gtin), plain and Arabic column names for a hand-made
  sheet; variants (`item_group_id`) are one product; the regular price, not the sale price; https
  pictures only; Arabic titles kept as the Arabic name. `.xlsx` through a 90-line reader
  (`lib/xlsx.ts`) on the runtime's own unzip (DecompressionStream).
- **Every plan**: it is another way of adding products, which every plan has — not one of the store
  platforms the plans list. Plan product limits still hold (the engine records the rest, with the reason).

**Why.** You asked for merchants who will not link their store. The sync engine already does what a feed
needs — paging, limits, archiving with its guard against a broken source, a per-connection interval.

**Seen.** Your sample Salla feed (1,240 items, 2.8 MB) reads in under 0.1 s; on this machine the link was
imported through the screen and synced: 198 products (the trial's 200-product limit), Arabic names and
prices, 189 with pictures; the 1,042 over the limit recorded as "plan limit reached".

**No new dependency.** **Schema:** `drizzle/0043_feed_provider.sql`.

**Rollback path.** Revert the commit; run the migration's ROLLBACK (feed connections deleted, their
products kept, unlinked). The enum value stays, unused. Cost: low.

## T72 · 2026-10-04 · The product limit counts products shown in 3D or the try-on — the catalogue is never limited (you asked)

**Decision.** You asked for the whole catalogue to come in ("import all"). The plans already describe the
limit as products **with 3D viewing** ("20 منتجًا بعرض ثلاثي الأبعاد"), so that is what it now counts:
products not deleted with AR switched on or a try-on switched on (`liveProductIds`). A sync, a feed, a file
or a product added by hand is never refused or cut short; switching 3D (`updateProduct`) or the try-on
(`updateTryOn`) on past the limit is refused (`assertRoomToShow`; one already shown is not counted twice).
The home screen's meter and the staff console say "Shown in 3D or try-on".

**Also.** A feed's sizes (`product_width` / `product_height` / `product_length`, "20 cm", "8 in"; plain
numbers in a sheet are mm) fill a product's size **only while it has none** — once set, the size is the
merchant's (the engine's rule, kept). Your Black Wing feed has no sizes (only a shipping weight), so its
products still need theirs; the template now has the three columns.

**Not changed.** The plan cards' wording for Growth ("200 منتج") is left as it is; it reads the same way.

**Rollback path.** Revert the commit: the count goes back to every product row and syncs stop at the limit
again (rows already imported stay). Cost: low.

## T73 · 2026-10-04 · Numbered pages on every long list (you asked)

**Decision.** You asked for numbered pages, "3 at the start and 3 at the end", on Products and the other pages.
One pager (`Pagination` in `components/dashboard/ui.tsx`, the numbers from `lib/pagination.ts`) shows previous,
the first 3 pages, the current page with its neighbours, the last 3 pages, and next. A "…" that would hide a
single page shows that page instead. It is used on:
- **Products**: 50 a page. `GET /api/products` takes `page`; the cursor still works for other callers.
- **AR settings** (إعدادات العرض): 50 a page, plus a search box. The list used to stop at 500 products, so
  in a store of 1,243 a product could be missing. `GET /api/ar-configs` now takes `?page=&q=` and returns
  `total`, `page` and `pageSize` beside `configs`. Products already set up (3D on, a try-on, saved settings or
  published) are listed first, newest first, then the rest of the catalogue, newest first.
- **3D models**: 25 a page (the list comes whole from the server and is paged on screen).

**Not yet.** The staff console's lists (stores, people, billing, one store's activity) keep "Show more":
they page by cursor and have no totals. Numbered pages there need totals from those queries.

**Rollback path.** Revert the commit: "Show more" comes back, and AR settings goes back to its first 500
products. Cost: low.

## T74 · 2026-10-05 · Products sort by any column; a quote request asks first (you asked)

**Decision.** Each column header on Products is a button with a sort icon (↕ when idle, ↑ or ↓ when
active). Sorting happens in the database, because the list is paged: the sorted order carries across
every page. One click sorts in the column's natural direction (names, types and states A→Z; price,
size, views and last change biggest or latest first), a second click reverses it, and a third returns to
newest first. Empty values (no price, no size, no model) always come last. Ties go newest first. Model
sorts ready → processing → failed → none. The AR column sorts on the shop → switched on → off. Views
count the last 30 days. `GET /api/products` takes `sort` and `dir`. A sorted list pages by `page`, not
the cursor.

**Also.** "اطلب عرض سعر" (request a quote) now asks first, in a calm blue box rather than the red delete
box. Its wording only repeats what the panel already promised: the price comes first, nothing starts
until you accept, and you can cancel before work starts. Note boxes (`.field textarea`) now look like
the other inputs, so they're visible in dark mode.

**Rollback path.** Revert the commit. Cost: low.

## T75 · 2026-10-05 · Publish and try a product on this computer, before linking a store (you asked)

**Decision.** You asked to try the button before adding your store, from the dashboard. Publishing
already doesn't need a store: it writes the product's settings for the widget and for **the product's own
page** (`/p/{store}/{product}`), which is Tajribah's and works with no store linked. On this computer,
three things stopped it, and each is now fixed **for local addresses only**:
- **The check refused http pictures.** Local storage is plain http, and the widget only accepts https
  (shops load nothing else). The check now treats this computer's own storage address
  (`http://127.0.0.1:…` / `http://localhost:…`) as https (`checkable`, edge/build.ts). The published settings
  keep the real address. The widget's parser that ships to shops is unchanged.
- **Nothing served published settings.** The config host (`cfg.tajribah.com`) is a separate Worker that
  doesn't run here. This Worker now answers `/v1/{store}/{product}.json` from what it published, only
  when opened at localhost or 127.0.0.1 (server/worker/entry.ts).
- **The website's try-on pages looked for settings on the real config host.** On a local address, with
  no `base`, they now use this app's own `/v1` (the product page and the try-on frame, on the server and
  in the browser).

**Seen.** The sample watch published locally (version 1). Its page at
`http://127.0.0.1:8799/p/store-ymc7f8/<id>` shows the try-on studio with the watch on a real wrist at
29.3 mm.

**Limits.** Published settings are held in memory on this computer, so they need publishing again after
the server restarts. On real addresses nothing changes.

**Rollback path.** Revert the commit: local publishing is refused again. Cost: low.

## T76 · 2026-10-05 · Rows per page (10, 25, 50, 100) and row numbers on every long list (you asked)

**Decision.** A "عدد الصفوف" (rows) picker with 10, 25, 50 or 100 sits beside the search, or in the
panel's corner where a list has no search. It starts at 10, and changing it returns to page 1. Each row
shows its number, counted across pages (page 2 at 10 per page starts at 11). It's on Products,
AR settings, 3D models and Visits. Visits used to have "Newer / Older"; it now has numbered pages, and
the server counts the day's visits for the current filter (`total`) and takes a `limit`. How far into a
day it can page stays capped as before. `GET /api/ar-configs` takes `pageSize`. A value that isn't one of
the four gives the previous size (50).

**Also (T75 follow-up).** On this computer, published settings now live in the local storage
(`edge-configs/…`) instead of memory, so they survive restarting the dashboard. Before, the dashboard
showed a product as published while its page couldn't find it. This applies only when storage is an S3
server at localhost or 127.0.0.1. Asking for KV still means KV, and elsewhere memory is used as before.

**Rollback path.** Revert the commit. Cost: low.

## T77 · 2026-10-05 · A feed's categories come in, and name the product's type when they can (you asked)

**Decision.** Every item in your Failet feed carries the store's own category (`g:product_type`:
"ساعات نسائية", "خواتم نسائية", "حلق"…). It is now kept as **this store's category**, using the
`categories` table and `products.category_id`, which already existed unused, so no migration was needed.
- **Shown and used.** It appears on the product's page (under "من متجرك"). The Products list has a
  category column (sortable; click a category to filter by it) and a category picker with counts
  (`GET /api/products/categories`, `?category=` on the list).
- **It follows the store.** It updates on every sync, like the name. A product whose store gives no
  category has none. One row exists per category name per store.
- **Type, only when the words name one type.** "ساعات…" means watch; "خواتم", "حلق", "سلاسل", "تشوكر",
  "أساور", "خلاخل" and "Jewelry > Rings" mean jewelry; also glasses, bags, clothing and furniture. A Google
  path is read from its most specific step. An Arabic stem must begin a word ("سوار" is not inside
  "إكسسوارات"). Words that could mean either thing ("أطقم" sets, "إكسسوار" accessories) name nothing:
  the type stays "other" for you to choose. Like sizes, a type fills only a product still "other". A type
  you chose is never overwritten.

**Why not guess from titles.** The store's category is the store's own statement; a title is prose.
Nothing is inferred beyond what the category says.

**Rollback path.** Revert the commit. Category rows stay (harmless). Cost: low.

## T78 · 2026-10-05 · Remove an old store with its products (you asked)

**Decision.** A disconnected store's panel has "احذف المتجر ومنتجاته" (remove the store and its
products), behind a red confirm that says how many products go. It works only on a disconnected
store, so an active store is never wiped by one click. Its products are deleted the way you delete one
(soft: `deleted_at`, archived, 3D off) in one transaction. The link and its sync history go too, and one
audit entry records the count. Any that were on your shop are taken down. `POST /api/connections/{id}/remove`.

**Rollback path.** Revert the commit. Removed products stay soft-deleted in the database. Cost: low.

## T79 · 2026-10-05 · Preview any product from its store's pictures, with no 3D model (you asked)

**Decision.** You said 3D models come later and that every product should be previewable now from its
feed's pictures. Every product has a **preview** (`/dashboard/products/{id}/preview`), opened from the
eye icon on each Products row and "معاينة" on the product's page. It shows the product as a shopper sees
it: the store's pictures (the main one large, every `additional_image_link` as a thumbnail to switch to),
name, price, the store's category and the type, the size if set (or that it is missing), and the
description as plain text. It ends with what the shop's button would open: the 3D view ("shows once
this product has a model") and, for a watch, jewelry, glasses or bag, the try-on with a link to set it up.
Nothing is published and nothing is needed.

**Also.**
- **Pictures load in the dashboard.** The page policy allowed images only from the dashboard itself, so
  store pictures (cdn.salla.sa…) could never show. `img-src` now also allows https: (any store's CDN).
  A picture can't run code, plain http stays out, and scripts are still held to the nonce. The Products
  list shows each product's picture.
- **The try-on's state is the try-on's.** `tryonEnabled` on a product was a column nothing ever wrote, so
  it always said off, here and in the public API. It is now read from the try-on's own switch.

**Rollback path.** Revert the commit. Cost: low.

## T80 · 2026-10-05 · A store picture as the try-on picture (you asked: "use the images you get from the feed")

**Decision.** Each picture slot on the try-on screen has "من صور المتجر" (from the store's pictures).
It shows the product's own feed pictures, and choosing one makes it the try-on picture, with no upload.
The server fetches it the way it fetches a feed (`server/modules/tryon/store-picture.ts`): https only, a
public address checked on every redirect (3 at most), 15 seconds, 10 MB at most. Then it goes through the
**same check as an upload** (`confirmCutout`). A JPEG is refused plainly because it has no transparent
background. Only a picture the store gave **this product** can be chosen, so the server never fetches an
address chosen by the caller. `POST /api/tryon/{id}/images/from-store`.

**Seen with Failet's feed.** Of the women's watch's first three pictures, two are PNGs on a white
background, refused with the check's own words ("has no transparency"). The third is a true cut-out,
which was accepted and attached.

**Rollback path.** Revert the commit. Cost: low.

## T81 · 2026-10-05 · Store linking moves to version 2; a feed link or a file is the way in (you asked)

**Decision.** You chose to settle, for now, on bringing products in "without linking the store: from a
link or a file", as Google Merchant Center does. Linking a store's platform (Salla, Zid, Shopify,
WooCommerce) moves to version 2. One switch, `STORE_LINKING = false` (`lib/features.ts`), hides it:
- **Store connections:** the four platform cards are gone, and the feed-link and file panel leads. The
  page's lead and its "what we read" line now describe a feed: re-read every 24 hours or on "Sync now",
  and a file imported once.
- **Elsewhere:** the home screen's empty state, Products' empty state, AR settings, sign-up and the setup
  guide's "connect" step point to importing from a feed link or a file, not to Salla or Zid.
- **Kept:** the connectors, their endpoints, webhooks and tests stay and keep passing. Turning the
  switch on brings everything back. Existing connections still show (a disconnected one can now be
  removed, T78).
- **The plan:** PROGRESS lists P1.4, P1.5, Zid, Shopify (and WooCommerce, built, now hidden) and P4.7
  under "Version 2 — later". The phase totals no longer count them.

**Not changed.** The website's integration pages (/salla, /zid, /integrations) are marketing, not the
dashboard; they're left for your word.

**Rollback path.** `STORE_LINKING = true`. Cost: none.

## T82 · 2026-10-05 · One domain, tajribah.com, with its subdomains; the QR tested with a phone on your Wi-Fi (you asked)

**Decision.** Everything runs on **`tajribah.com`**: one Worker serves the website, sign-in, the
dashboard, the staff console, products' pages (`/p`), the shop try-on (`/embed/try-on`), the phone page
(`/capture`) and the API. Three subdomains hold what must live apart: `cdn.` (files), `cfg.` (published
settings, read without the database) and `ev.` (shop events). `domains.` is the name stores point their
own domain at. The code mixed `tajribah.sa` (site, dashboard, product pages) with `tajribah.com`
(services). Its defaults are now all `tajribah.com`: `DEFAULT_HOSTED_PAGE_BASE`, `DEFAULT_TRYON`, the
site's URL, the domains target, the problem-type links, and `.env.example`. GO-LIVE, HOSTING, ARCHITECTURE
and RUNNING-LOCALLY say the same. `docs/DOMAINS.md` describes it all.

**The QR, locally.** A phone can't open `127.0.0.1`, so the computer can serve on its **Wi-Fi address**
(`bash start-storage.sh lan` and `bash start-dashboard.sh lan`, which find and print it). The local
stand-ins (http pictures, this Worker answering `/v1`, the page policies' local servers) now switch on
for private network addresses (10.x, 172.16–31.x, 192.168.x) as well as localhost and 127.0.0.1
(`isPrivateLanAddress`). No outside network can reach such an address, so a public site never has one.
The QR page gets a third state, **test only**: when the product-page address is this computer, its codes
are scannable by a phone on the network but can't be printed or downloaded. A printed code still
requires the final https address.

**Seen** (computer at 192.168.100.8): a product page opened at the Wi-Fi address with its pictures; the
QR page showed a scannable test code with no downloads; the phone-to-computer photo arrived whole
(52,501 of 52,501 bytes).

**Rollback path.** Revert the commit. Addresses go back to the mixed defaults, and Wi-Fi testing stops.
Cost: low.

## T83 · 2026-10-05 · Earrings on the shopper's own photo; the jewellery FAQ brought up to date

**Decision.** Earrings now also work on the shopper's own photo, the last part of P5.5. Ears aren't found
reliably by a face detector (and in a side photo, where the ear shows, the face often isn't found at all),
so the shopper taps two points, as "Fit to eyes" works for glasses: **the top of the ear, then the bottom
of the lobe**. The ear is taken as 60 mm long, the same figure as the ear model photo. The piercing sits
9 mm above the lobe's bottom, measured on that photo, so 15% of the ear's length. The earring's picture
hangs straight down from there with its top edge at the piercing (the demo hoop's hinge is within 6% of
its top). The fitting starts by itself once the photo is in, and "ضبط على الأذن" (fit to ear) starts it
again. Added to the studio beside the other kinds; nothing it already did changed.
`tryOnProductFrom` gives earrings "on me" when the plan allows it (a bag still doesn't).

**Also.** The jewellery page's FAQ asked "When will neck try-on be available?", but necklaces already
work on a model and on the shopper's photo. It now answers that necklaces and earrings work on the
shopper's own photo, and how. The jewellery, features and demo pages no longer say earrings on your
photo "come later".

**Seen.** On /demo, an ear photo (Pexels 8092973, the one the ear model was cut from) uploaded as the
shopper's; the two taps hung the 10.6 mm hoop from the lobe at the photo's real piercing.

**Rollback path.** Revert the commit. Cost: low.

## T84 · 2026-10-05 · Bags in the shopper's own hand — every kind now works on the shopper's photo

**Decision.** A bag now also works on the shopper's own photo, the last part of P5.6. The shopper uploads
a photo of themselves standing with a hand at their side. The hand is found on their device (the same
hand model as the wrist and the ring), and the bag hangs straight down from the fingers, the top of its
handles where the fingers curl round them (the middle finger between its base and middle joints). On the
demo model, her fingers start just above the handles' top, which matches.

**The scale.** A hand at the side is usually seen edge-on, which squeezes the knuckles together: the
first try, with the knuckle span alone (62 mm, as for a ring), drew the bag about a quarter of its size.
So the scale is the larger of two adult measures, the palm (wrist to the middle knuckle, about 100 mm)
and the knuckle span (about 62 mm). Seen at an angle, a length can only look shorter, so the larger one
is the truer. If the hand isn't found, "ضبط على اليد" (fit to hand) asks for two taps that stay apart
in a side view: the wrist, then the middle knuckle. Handles are taken as centred in the picture; the
studio already says a bag's size and placement are approximate. Added to the studio beside the other
kinds; nothing it already did changed.

**Also.** The demo still said necklaces, rings and glasses on your own photo "come later" (they have
worked since T68), and so did the glasses industry page; corrected. The earring's upload button, file
picker and phone code fell back to the watch's "wrist" wording on some paths; they now say a side photo.

**Seen.** On /demo, a real photo (Pexels 7249224, a woman in an abaya with her hands at her sides; used
to test only, not shipped): the hand was found and the bag hung from her fingers; in English, the two
taps placed it too.

**Rollback path.** Revert the commit. Cost: low.
