# Tajribah — where the build is

_Last updated: 2026-09-23 · updated at the end of every work session_

> **Now:** **P1 has started** (your call, 2026-09-23) — only the parts that need no account. Done so far: the onboarding checklist, the real product catalogue, the store-connection plumbing, the sync engine, receiving webhooks from the store, uploading 3D models, and shrinking them for phones.
> **Next:** the product detail screen (P1.10), then the store connection screen (P1.11). **One question for you:** see P1.13b below.
> **P0:** code gate passed; the rest waits on you — see below. [Gate report](docs/gates/P0.md)
> **Waiting on you:** a **Hetzner server** for the database (your choice), and the accounts below.

```
P0 Foundation     ████████████████████████████░░░░  19 / 22   (+ P0.20 mostly done, 2 blocked)
P1 Core loop      ██████████░░░░░░░░░░░░░░░░░░░░░░   8 / 26   ← first sellable product (started)
P2 Billing        ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 15
P3 3D pipeline    ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 12
P4 Analytics      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 12
P5 Try-on         ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 14   (engine already exists in tajribah-try-on)
P6 AI+connectors  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 16
P7 Scale          ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 13
P8 Enterprise     ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 12
M  Marketing      ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 12   (separate site in tajribah-try-on)
A  Admin console  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 14
                                            overall  27 / 168
```

"Done" means the check was **run and seen to pass**, and also seen to **fail** when the
thing it protects was broken on purpose. Code that merely exists does not count.

---

## P0 — Foundation (nothing a merchant sees yet)

| | Package | In plain words |
|---|---|---|
| ✅ | P0.1 Repo scaffold | The project, folders and working rules |
| ✅ | P0.2 Config & secrets | Settings are checked at startup, all problems listed at once; the `.env.example` template is generated and a test catches it going stale |
| ✅ | P0.3 Error model | Every error comes back in one standard shape |
| ✅ | P0.4 Database | 50 tables on Postgres, with undo scripts |
| ✅ | P0.5 Tenancy core | Every query is locked to one store |
| ✅ | P0.6 Isolation suite ⭐ | Proves store A can never see or change store B's data — two independent layers, both tested |
| ✅ | P0.7 Auth crypto | Password hashing, login tokens, OTP codes |
| ✅ | P0.8 Sessions | Login, logout, password reset, stolen-token detection |
| ✅ | P0.9 Email & SMS | OTP SMS and emails in Arabic + English; an Arabic SMS longer than 70 characters is refused before it can ship |
| ✅ | P0.10 Roles | Owner / admin / editor / analyst / viewer permissions |
| ✅ | P0.11 Audit log | Every change records who, what, before/after, and which request — or the change is cancelled |
| ✅ | P0.12 Plans & limits | Plan quotas (e.g. max products) enforced |
| ✅ | P0.13 Background jobs ⭐ | Job queue where one busy store cannot starve the others |
| ✅ | P0.14 File storage | 3D models and photos stored per store on Cloudflare R2; the browser uploads straight to R2 with a link that works for one file, for up to an hour. Tested locally — the real R2 waits on the Cloudflare account |
| ✅ | P0.15 Arabic/English core | RTL, SAR, Hijri dates, +966 numbers, Arabic digits |
| ✅ | P0.16 Design system | Colours, fonts, dashboard components, both directions |
| ✅ | P0.17 Dashboard shell | Sidebar, store switcher, 11 screens (demo data) |
| ✅ | P0.18 Monitoring | Every log line carries the request's id (and the store and user once known), including background jobs that request started; crashes return a clean error with the id, details stay in the log |

| ✅ | P0.19 API | 9 real endpoints: sign up, sign in, refresh, sign out, who-am-I, switch store, verify email, password reset. Stolen-token detection, sign-out takes effect instantly, other websites cannot trigger them |
| ◐ | P0.20 Dashboard ↔ API + real login | Sign-in, sign-up, sign-out and "send me back to the page I wanted" are built and tested end to end. The real app now runs in a browser here: opening the dashboard signed out lands on the sign-in page. Left: actually signing in through the browser — needs the database host |
| 🔒 | P0.21 CI pipeline | Every push runs all checks automatically — needs a GitHub repo/CI runner |
| 🔒 | P0.22 Staging server | A live test copy of the platform — needs the Cloudflare account and a database host |

**The P0 gate ran on 2026-09-22.** It re-checked every package, added 20 missing tests, and
found and fixed 5 real bugs (Saudi weekend computed in UTC, `00966…` phone numbers refused,
a database rollback that could not run, the dashboard breaking on phones, and the store
switcher missing on most screens). Full report: [docs/gates/P0.md](docs/gates/P0.md).

## P1 — the first sellable product (started 2026-09-23)

Signup → connect a Salla store → products sync → a 3D/AR viewer is live on the merchant's
storefront. 26 packages. You chose to start the parts that need **no account**; the ones
marked 🔒 in `docs/PACKAGES.md` wait for Salla / Cloudflare / the domain.

| | Package | In plain words |
|---|---|---|
| ✅ | P1.1 Onboarding checklist | The "finish setting up" list ticks itself off from what the store has actually done (connected Salla, sized a product, a model is ready, the button is live) — not from a checkbox that can go stale |
| ✅ | P1.8 Products | The real product catalogue behind the Products screen: search (Arabic too), filters, paging; AR can only be switched on once the size in mm is filled in; products that come from Salla keep their name and price from Salla; deleting is recoverable; every change is logged |
| ✅ | P1.3 Store connections | The plumbing every store connector (Salla, Zid…) uses. Store passwords (tokens) are locked away encrypted and never shown or logged; a store can belong to one Tajribah account only; tokens renew themselves before they expire, and if the store cuts us off the merchant is told to reconnect. Calls to the store give up on a hung store, retry sensibly, back off when the store is struggling, and never spend one merchant's API allowance on another. Testing found one real bug (an order-type request could have been sent twice after a dropped connection) — fixed |
| ✅ | P1.6 Product sync | Copies a store's whole catalogue into Tajribah — tested with 10,000 products — then keeps it up to date with only what changed. It works in short steps, so if the store goes down halfway it picks up where it stopped instead of starting over, and running it twice never creates duplicates. It only changes what the store owns (name, price, photos…) — sizes and AR settings you set are never overwritten. Products removed from the store are archived, but if a store suddenly seems to have lost most of its catalogue, nothing is archived and you're told why. Plan limits are respected, and the reason is shown |
| ✅ | P1.7 Store webhooks | When something changes in the store (a product edited or deleted, the app uninstalled), the store tells us straight away. Each message is checked to prove it really came from the store — fakes are refused and never saved — and a message sent twice is only acted on once. Changes trigger a quick sync, deleted products are archived, an uninstall disconnects the store. A message that fails to process is retried, then kept so it can be re-run with one click. Salla's exact message format is plugged in once the Salla account exists |
| ✅ | P1.6b Automatic sync schedule | Every store is kept up to date on a timer (hourly by default), new stores first. A store whose sync keeps failing is retried once an hour, not hammered. A sync that got stuck (for example the server restarted mid-way) is noticed after 15 minutes and resumed. The sync history is stored month by month so it stays fast as it grows, with the same store-to-store privacy checks as everything else |
| ✅ | P1.9 Products screen | The product list now asks the server for each page, so it stays fast with thousands of products. Search (Arabic too), filters and their counts all come from the real data; "Show more" loads the next page. Checked in Arabic and English, on a laptop and a phone |
| ✅ | P1.12 Upload a 3D model | A merchant uploads a .glb (Android / web) or .usdz (iPhone) file for a product, up to 50 MB. The file goes straight to storage, not through our servers. Before it's accepted, the file itself is checked — not just its name — so a renamed photo, an old format, or an upload that got cut off halfway is refused with a clear reason and deleted. Each new upload becomes the next version of that product's model; it never goes live by itself |
| ✅ | P1.13 Shrink models for phones | After an upload is accepted, the model is automatically cleaned up and compressed so it opens faster on a phone (unused parts removed, repeated parts shared). Each model shows its size before and after, and whether it's under the 2 MB target. The original is kept. It is marked ready, but only goes live when you publish it |
| ❓ | P1.13b Texture compression + iPhone files | Compressing textures (usually most of a model's size) and making the iPhone (.usdz) version automatically both need extra tools installed on the server that runs background work. **Decision needed** — see below |

---

## Waiting on you

**External accounts** (these are the real critical path — each takes days to approve):

| | Account | Blocks |
|---|---|---|
| ⬜ | Salla Partner + app registration | All of P1 |
| ⬜ | Cloudflare (R2, Workers, KV, DNS) | File storage, the live AR viewer |
| ⬜ | Domain `tajribah.com` + a short domain | AR pages, QR codes, email links |
| ⬜ | Moyasar merchant account | Billing (P2) |
| ⬜ | ZATCA Fatoora onboarding | E-invoicing (P2) |
| ⬜ | Unifonic (SMS / WhatsApp) | Real phone OTP |
| ⬜ | 3D generation API (Meshy / Tripo3D / CSM) | P3 |
| ⬜ | **Hetzner server** (for Postgres) | Real sign-in, staging, anything saved outside tests |

Before paying for any of them: check the name **Tajribah** is free (`.com`, `.sa`, Salla and
Zid app names, Saudi trademark search).

**Decided 2026-09-23:**
- Database: **Postgres on a Hetzner server.** Needed from you: the server (a CX22-class
  machine is enough to start). Until it exists, sign-in cannot work in the browser.
- Arabic text uses **ASCII digits** (30, 15%) — done; a test keeps it that way.
- **Start P1 without waiting** for CI/staging — only the parts that need no account.

**This machine:** the app now runs here using a temporary Node 22 (your installed Node 20
is untouched). Installing Node 22 properly would make that permanent — optional.

---

## Session log

| Date | What happened | Tests |
|---|---|---|
| 2026-09-22 | Project created; foundation packages P0.1–P0.8, P0.10, P0.12, P0.13, P0.15–P0.17 | 82 pass |
| 2026-09-22 | Found a half-finished switch to Postgres that had broken 56 tests; finished it (second database role, test fixes) | 126 pass / 0 fail |
| 2026-09-22 | P0.9 Email & SMS | 137 pass / 0 fail |
| 2026-09-22 | P0.11 Audit log · this file created | 144 pass / 0 fail |
| 2026-09-22 | P0.14 File storage | 152 pass / 0 fail |
| 2026-09-22 | P0.2 settings template · P0.18 request ids | 162 pass / 0 fail |
| 2026-09-22 | **P0 gate** — 20 missing tests added, 5 bugs fixed, report written | 182 pass / 0 fail |
| 2026-09-23 | P0.19 API — sign-up, sign-in, sessions, password reset | 195 pass / 0 fail |
| 2026-09-23 | P0.20 dashboard ↔ API, sign-in/out, protected pages (browser run pending) | 199 pass / 0 fail |
| 2026-09-23 | Audit log can no longer be edited or deleted by the app — only added to | 200 pass / 0 fail |
| 2026-09-23 | The real app runs on this computer for the first time; code-quality checker (lint) ran for the first time — 4 real bugs fixed; sign-ins/outs now in the audit log | 201 pass / 0 fail, 0 lint errors |
| 2026-09-23 | Your decisions applied: Hetzner database recorded, Arabic digits → ASCII everywhere, P1 opened for account-free work | 202 pass / 0 fail |
| 2026-09-23 | P1.1 onboarding checklist | 209 pass / 0 fail |
| 2026-09-23 | P1.8 product catalogue (real, behind the Products screen) | 217 pass / 0 fail |
| 2026-09-23 | P1.3 store connections (first session on the Mac) — 1 real bug found and fixed | 236 pass / 0 fail |
| 2026-09-23 | P1.6 product sync (10,000-product test) · fixed a billing bug: every paid plan was being treated as Starter | 246 pass / 0 fail |
| 2026-09-23 | P1.7 store webhooks (fakes refused, duplicates ignored, retry + replay) | 253 pass / 0 fail |
| 2026-09-24 | P1.6b automatic sync schedule + monthly history storage; fixed a gap in the privacy test suite | 262 pass / 0 fail |
| 2026-09-24 | P1.12 3D model upload (file checks, versions) | 268 pass / 0 fail |
| 2026-09-24 | P1.13 models shrunk for phones; texture/iPhone step waits on a server-tools decision | 273 pass / 0 fail |
| 2026-09-25 | P1.9 products screen on real search and paging | 278 pass / 0 fail |
