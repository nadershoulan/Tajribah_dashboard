# Tajribah — where the build is

_Last updated: 2026-09-28 · updated after every package_

> **Now:** building every piece that needs no account, phase by phase. Two sessions work in parallel: this one (website, analytics screen, security, 3D generation) and a second one (collecting analytics from shop pages).
> **Just finished (2026-09-28):** 3D models now actually get under 2 MB. A real product model went from **8.97 MB to 509 KB** and looks the same in the 3D viewer. Found and fixed on the way: **the storefront's 3D viewer could not open any of our compressed models at all** (it was never told where the decoder is) — nothing was live yet, so no shopper saw it · before that: the photo screen on every product page.
> **Next:** P3.6 — the staff review queue for 3D models: every new model is checked by a person before shoppers see it, starting with the ones post-processing flagged. No account needed.
> **Waiting on you:** **how many AI credits one 3D generation costs** (no number exists anywhere yet), the **Hetzner server**, and the accounts below — Salla, Cloudflare, the domain, Moyasar and a 3D-generation provider are what most of the remaining work needs.

```
P0 Foundation     ████████████████████████████░░░░  19 / 22   (+ P0.20 mostly done, 2 blocked)
P1 Core loop      █████████████████████████░░░░░░░  20 / 26   ← first sellable product · the rest needs Salla / Cloudflare / domain
P2 Billing        █████████████░░░░░░░░░░░░░░░░░░░   6 / 15   (+ 3 partly) · the rest needs Moyasar / ZATCA
P3 3D pipeline    ████████░░░░░░░░░░░░░░░░░░░░░░░░   3 / 12   (+ P3.7 photo screen) ← NOW · Generate waits on a provider and a price
P4 Analytics      ███████████░░░░░░░░░░░░░░░░░░░░░   4 / 12   (+ CSV export partly) · shared with the other session
P5 Try-on         ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 14   (engine already exists in tajribah-try-on)
P6 AI+connectors  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 16
P7 Scale          ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 13   (+ P7.7 security: all code-level work done)
P8 Enterprise     ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 12
M  Marketing      ████████████████████████░░░░░░░░   9 / 12   (+ 3 partly) · the website, in tajribah-try-on
A  Admin console  ███████████████████████░░░░░░░░░  11 / 15   (+ A7 partly) · the rest needs Moyasar / P3
                                            overall  72 / 169
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
| ✅ | P1.2 Setup guide, email check, password reset | A new merchant now lands on a **setup guide** after signing up: the seven steps, which are done, and one clear action for the next one. They confirm the store's name and choose its web address (an Arabic store name no longer gets a random address they never saw — they pick it, once, before it goes into the install code). They can carry on with the free trial instead of picking a plan, and skip connecting Salla for now — and undo either. The **"confirm your email"** link now opens a real page (it went nowhere before), with "send me a new link" if it expired. **Forgot password** now works end to end (the link on the sign-in page went nowhere): ask for a link, set a new password, and every open session is ended for safety. Also fixed: the "store details" step could never be completed from any screen, and the show-password eye sat on top of the password in Arabic |
| ✅ | P1.2b Two-step sign-in | Anyone on the team can turn on a second step for their own account (the new "Sign-in security" link at the bottom of the menu): scan a QR code with Google or Microsoft Authenticator, type the first code, and save 10 backup codes (download or copy — shown once). From then on, signing in asks for the app's code after the password, so a leaked password alone gets nobody in. A code works once, wrong codes lock the account like wrong passwords, and turning it on or off needs the password again and sends an email. Codes typed in Arabic numerals work. SMS codes wait on the SMS provider |
| ✅ | P1.8 Products | The real product catalogue behind the Products screen: search (Arabic too), filters, paging; AR can only be switched on once the size in mm is filled in; products that come from Salla keep their name and price from Salla; deleting is recoverable; every change is logged |
| ✅ | P1.3 Store connections | The plumbing every store connector (Salla, Zid…) uses. Store passwords (tokens) are locked away encrypted and never shown or logged; a store can belong to one Tajribah account only; tokens renew themselves before they expire, and if the store cuts us off the merchant is told to reconnect. Calls to the store give up on a hung store, retry sensibly, back off when the store is struggling, and never spend one merchant's API allowance on another. Testing found one real bug (an order-type request could have been sent twice after a dropped connection) — fixed |
| ✅ | P1.6 Product sync | Copies a store's whole catalogue into Tajribah — tested with 10,000 products — then keeps it up to date with only what changed. It works in short steps, so if the store goes down halfway it picks up where it stopped instead of starting over, and running it twice never creates duplicates. It only changes what the store owns (name, price, photos…) — sizes and AR settings you set are never overwritten. Products removed from the store are archived, but if a store suddenly seems to have lost most of its catalogue, nothing is archived and you're told why. Plan limits are respected, and the reason is shown |
| ✅ | P1.7 Store webhooks | When something changes in the store (a product edited or deleted, the app uninstalled), the store tells us straight away. Each message is checked to prove it really came from the store — fakes are refused and never saved — and a message sent twice is only acted on once. Changes trigger a quick sync, deleted products are archived, an uninstall disconnects the store. A message that fails to process is retried, then kept so it can be re-run with one click. Salla's exact message format is plugged in once the Salla account exists |
| ✅ | P1.6b Automatic sync schedule | Every store is kept up to date on a timer (hourly by default), new stores first. A store whose sync keeps failing is retried once an hour, not hammered. A sync that got stuck (for example the server restarted mid-way) is noticed after 15 minutes and resumed. The sync history is stored month by month so it stays fast as it grows, with the same store-to-store privacy checks as everything else |
| ✅ | P1.9 Products screen | The product list now asks the server for each page, so it stays fast with thousands of products. Search (Arabic too), filters and their counts all come from the real data; "Show more" loads the next page. Checked in Arabic and English, on a laptop and a phone |
| ✅ | P1.18 AR on the shopper's phone | When a shopper taps the button: on an iPhone the product opens straight in Apple's AR viewer, on Android in Google's — no extra download, and locked to the product's real size so it can't be pinched bigger or smaller. On a computer it opens a 3D view on the page. Glasses and watches keep the 3D view until virtual try-on arrives. If something fails, the shopper sees a short message instead of nothing |
| ✅ | P1.17 Install in your store | The two lines to paste into your product page template (the old text on this screen would not have worked — fixed), and a checker: paste a product page's address and we open it and tell you exactly what's wrong — no code, the wrong store's code, the product number not filled in — and how to fix it. For safety it only opens pages of your own store. Every screen now also fits a phone properly |
| ✅ | P1.16 The AR button for your store ⭐⭐ | The small script that goes on your product pages: it adds the "View in your space" button in your brand colour and your store's language, and opens the 3D viewer when a shopper taps. It is tiny (under 3 KB), loads after your page, can't be restyled by your theme or restyle it, and if anything goes wrong it simply shows no button — it can never break your shop. It goes live once the Cloudflare account and domain exist |
| ✅ | P1.23 Bell and quick search | The bell now shows real notifications — only the ones worth your attention: a sync that failed, a model ready to publish or refused, an update from your store that couldn't be processed, someone accepting your invitation. Each person has their own, and reading them doesn't mark them for others. Ctrl+K (or the search icon) jumps to any screen you're allowed to open, or to a product by name or SKU, in Arabic or English |
| ✅ | P1.21 AR button settings | For each product: the button's text in Arabic and English, its style, and where the product is placed in AR — on the floor, a wall or a table, or on the face / wrist for glasses and watches (the screen only offers what fits the product). A live preview shows the button in your brand colour. Settings are saved now; they go live on your store pages once the Cloudflare account is set up |
| ✅ | P1.22 Home screen | The home screen now shows your store's real numbers: the last 30 days of views, AR sessions and purchases, your catalogue counts, how much of your plan you're using, the setup checklist, and recent activity (syncs, models, team). Until the analytics collector runs, the numbers are zero rather than made up — and the "conversion uplift" figure says "not enough data yet" instead of guessing |
| ✅ | P1.25 Store settings | Your business details for invoices — store name in English and Arabic, commercial registration and VAT numbers (checked for the right format, Arabic numerals accepted), national address — plus the look of the AR button (your brand colour and corner roundness, with a live preview) and the camera consent text. Nothing is pre-filled with made-up numbers. The data export/erasure buttons are switched off until that process exists, instead of pretending to work |
| ✅ | P1.24 Team | Invite people by email with a role (admin, editor, analyst, viewer). They join by signing in with that same email — a forwarded link is useless to anyone else — and the link works once, for 7 days. Change someone's role or remove them (they lose access immediately). There is only ever one owner, and nobody can give a role above their own. Pending invitations count toward your plan's team size. Every change is in the activity log |
| ✅ | P1.14 3D model library | All your models in one place, each with its versions: size before and after compression, and whether it's under 2 MB. You choose which version shoppers see ("Publish"), and can go back to an older one in one click — a new upload never goes live on its own. Upload by picking a file or dropping it on the list; wrong files are refused with the reason, in Arabic too |
| ✅ | P1.11 Store connection screen | Shows your connected store for real: whether it's working, when it last synced, a progress bar while a sync runs, and any errors (from syncing or from the store's update messages). "Sync now" and "Disconnect" work — disconnecting asks first and keeps all your products. The old "connection health %" was removed because nothing actually calculated it. Connecting a new store waits on the Salla account |
| ✅ | P1.10 Product page | Each product has its own page where you enter its real size in millimetres (Arabic numerals work), set its type and switch AR on. AR can't be switched on until width and height are filled in — the same rule the server enforces, checked by a test that compares the two. Name and price are shown but not editable here, because they come from your store |
| ✅ | P1.12 Upload a 3D model | A merchant uploads a .glb (Android / web) or .usdz (iPhone) file for a product, up to 50 MB. The file goes straight to storage, not through our servers. Before it's accepted, the file itself is checked — not just its name — so a renamed photo, an old format, or an upload that got cut off halfway is refused with a clear reason and deleted. Each new upload becomes the next version of that product's model; it never goes live by itself |
| ✅ | P1.13 Shrink models for phones | After an upload is accepted, the model is automatically cleaned up and compressed so it opens faster on a phone (unused parts removed, repeated parts shared). Each model shows its size before and after, and whether it's under the 2 MB target. The original is kept. It is marked ready, but only goes live when you publish it |
| ❓ | P1.13b Texture compression + iPhone files | Compressing textures (usually most of a model's size) and making the iPhone (.usdz) version automatically both need extra tools installed on the server that runs background work. **Decision needed** — see below |

## Track A — the staff console (started 2026-09-26)

The internal console for running Tajribah: stores, people, plans, coupons, what went wrong.

| | Package | In plain words |
|---|---|---|
| ✅ | A14 Privacy and retention | When someone asks for a copy of their data or for their account to be removed, staff record it (with how they checked who is asking), see it is due in 30 days, and do it in one click — the copy never includes passwords or security codes, and a store owner can't be removed until the store is handed over or closed. Old data (raw visitor events after 90 days, old sign-ins, old notifications, old logs) is removed automatically on a published schedule; invoices are always kept |
| ✅ | A4b See what the merchant sees | Staff can open a store's dashboard exactly as the store sees it, for 15 minutes to an hour, with a written reason — and change nothing. A banner on every screen says so, the store's own activity shows that Tajribah staff looked, and it ends by itself |
| ✅ | A13 Coupons and announcements | Staff can create discount codes the checkout accepts straight away, and publish a notice to every store's dashboard — a maintenance window, a new feature, holiday support hours — in Arabic and English, between two dates. Stores can dismiss a notice |
| ✅ | A12 Support lookup | Support pastes whatever a merchant sends — a store or invoice id, an email, an invoice number, a store name, or the reference number shown with an error — and sees what it is. For an error's reference number, it shows exactly what that request changed, in which store, and by whom. Each store's page now also shows its full activity. Only which fields changed is shown, never the store's data itself |
| ✅ | A11 Is the platform working? | One screen shows staff whether background work is keeping up (how long the oldest waiting job has waited, per queue), what is stuck or has given up, which store updates from Salla or Zid failed, and how far an encryption-key change has got — including when the old key can safely be removed. A job that gave up or an update that failed can be tried again, with a reason |
| ◐ | A7 Subscriptions and invoices | Staff can see every store's subscription (filter by status, plan, monthly or annual) and every invoice (by status, month or number), with totals that count only invoices that are due or paid, and open any invoice exactly as the store sees it. Refunds come with the payment gateway |
| ✅ | A6 Plans and prices | Staff can change a plan's monthly and annual price, its limits and its features. The change reaches every store on that plan straight away (as decided: nobody keeps old terms), and the screen says how many stores that is before saving. Lowering a limit deletes nothing — a store over it just can't add more — and the screen warns you to tell them first. The price a store sees on its plan cards is now always the price it will be charged |
| ✅ | A5 People | Staff can find anyone by email or name, see which stores they belong to and on which devices they are signed in, and — with a written reason — sign them out everywhere (a stolen laptop) or turn off their two-step sign-in (a lost phone; they get an email saying so, in their language). Nobody can do this to their own account |
| ✅ | A4 Changing a store | Staff can give a store more trial days, suspend it and bring it back, and add or take away AI credits. Each needs a written reason, and each shows up twice: in the staff activity, and in the store's own activity as done by Tajribah staff. A store that already pays can't be given trial days, credits never go below zero, and a store brought back returns to where its subscription says |
| ✅ | A3 Every store | Staff can find any store — by name (Arabic too), web address or id — filter by status and plan, and open a store to see its details, how much of its plan it uses (the same numbers the store sees), its invoices, connection, team, and anything staff changed on it. Looking changes nothing |
| ✅ | A2 Platform at a glance | The first page of the staff console: how many stores there are and in what state, new stores this month, trials ending this week, monthly and yearly recurring revenue (at list prices until payments are live — the page says so), subscriptions per plan, cancellations, invoices and AI use this month |
| ✅ | A1 Who can get in | The staff console now exists at /admin. Only Tajribah staff can open it — and only with two-step sign-in on; for anyone else it looks like a page that doesn't exist. Staff are marked directly in the database (no button can do it). Everything staff do there is written to a staff-only record that merchants' requests can't read or change. The console looks clearly different from a store's dashboard |

## P2 — billing (started 2026-09-26, parts needing no account)

You asked to carry on in a later phase while P1 waits on accounts. Billing is next in line;
about half of it needs no Moyasar account. Payments, ZATCA and anything that charges a card
wait for those accounts.

| | Package | In plain words |
|---|---|---|
| ✅ | P2.13 Billing messages | When an invoice is issued, or a payment fails, the store's owner and admins are told — in the dashboard and by email, each in their own language, and only once even if the payment system reports it twice. The payment-failed message says when the next attempt will be. These fire automatically once payments are connected |
| ◐ | P2.12 Discount codes | Discount codes now exist: a percentage, a fixed amount, or free months, each optionally limited to certain plans, to a number of uses and to dates. At checkout a store types a code and the server checks it (in Arabic too: expired, not for this plan, used up, already used by your store); the discount shows and the VAT is worked out on what's left. A store can use a code once, and a limited code can't be over-used even if two stores use the last one at the same moment. Codes are created from the admin console (coming); using one at payment arrives with the payment gateway |
| ◐ | P2.10 Billing screen | The billing screen now shows the store's real plan, prices, AI credits and invoices. Every button works: choosing a plan opens a checkout with monthly or yearly billing (showing the yearly saving), the VAT and the total — priced exactly as the invoice will be. The last step, paying, stays closed with a clear note until the payment gateway (Moyasar) is connected; nothing is charged. Some text promised things that don't exist yet (ZATCA QR, PDF download) — now it only says what is true |
| ✅ | P2.11 When a trial ends | Found a real gap: nothing actually stopped a store after its free trial ran out. Now, when a trial ends without a plan (or a subscription is cancelled), the store becomes read-only everywhere at once — every change is refused with a clear reason, nothing is deleted — while choosing a plan, fixing business details and reading everything still work. A banner says what happened, when, and links to choose a plan. Owners and admins get a reminder 3 days before, on the last day and when it ends, in the dashboard and by email, once each |
| ✅ | P2.9 AI credits | Each store's AI credits are now kept as a running list of entries that can only be added to, never edited — so any question about a balance can be answered by reading the list. Each month the plan's credits arrive (Starter 5, Growth 40, Pro 200); what isn't used by month-end lapses, while credits a store buys never expire, and the plan's are used first. A job that is retried is charged once, a payment delivered twice is credited once, a failed job is refunded once, and nobody can spend more than they have. Support corrections need a written reason and are logged. The 3D generation and payments that will use this come later |
| ✅ | P2.6 Invoices | Tajribah's invoices now exist: issued by **SRO Company** (your CR 7033242079) to the store, numbered in order with no gaps for each store and year, VAT 15% worked out per line so every figure adds up, and each invoice frozen as issued — if the store later renames itself, old invoices don't change. The invoice page shows everything in Arabic and English side by side, with Gregorian and Hijri dates, and prints or saves as PDF. SRO Company's VAT number (314550511700003, VAT from 2026-02-01) and national address are now on every invoice. The ZATCA QR comes with e-invoicing (needs the ZATCA account) |
| ✅ | P2.2 Counting what each store uses | Each number a plan limits is counted from one place that cannot double-count: storage is what the store actually holds now (a refused or abandoned upload no longer counts), AR sessions come from the daily analytics for this month, and bandwidth is recorded as a daily total that is replaced, never added to, if it is reported twice. Uploads are now refused up front when the plan's storage is full, with the limit named. The home screen shows exactly the numbers the limits check — it had been showing a smaller product count than the limit used, and on the 31st of a month it forgot the 1st. A storage meter was added. Still to come: deleting a model to free space |
| ✅ | P2.1 Plans in the database | The four plans (Starter, Growth, Pro, Enterprise) — prices, limits and what each includes — now live in the database, copied exactly from the pricing list and checked by a test. Every limit (products, team size…) is read from there, so a limit changed in the database applies at once, without a new release; the admin console will edit them later. Before this, a real database had no plans at all, so no store could ever have been subscribed. If something is missing from a plan, the answer is "no", never "unlimited". Enterprise shows no price instead of 0 |

## Track M — the website (in tajribah-try-on)

The public site that sells Tajribah, Arabic first.

| | Package | In plain words |
|---|---|---|
| ✅ | M2 Home & core pages | Home, features, how it works, integrations, about, contact |
| ✅ | M3 Pricing | The four plans with a monthly / yearly switch (a year costs ten months) and a calculator that shows when a plan pays for itself on the visitor's own numbers — we publish no uplift claims of our own |
| ✅ | M4 Salla & Zid pages | A landing page for each platform |
| ✅ | M5 Feature pages | One page per way to try — on the model, on your photo, true size, phone hand-off — each saying plainly what it does not do |
| ✅ | M6 Industry pages | Watches, jewellery, eyewear, bags — what works today and what is not built yet |
| ✅ | M7 Blog | 6 articles, no invented statistics |
| ✅ | M8 Help centre | 15 articles written against the real dashboard |
| ✅ | M10 Company & careers | About and careers pages |
| ✅ | M11 Legal pages | Privacy, terms, refunds, cookies — need a lawyer's review before launch |
| ◐ | M1 Site setup | Built; the cookie consent and site analytics wait on which analytics tool you choose |
| ◐ | M9 Customer stories | The page exists, with its stories clearly marked as examples; real ones need real customers |
| ◐ | M12 Search engines | Sitemap, page titles and share cards done; the rest needs the domain |

## P4 — analytics (started 2026-09-27, shared with the other session)

| | Package | In plain words |
|---|---|---|
| ✅ | P4.1 Counting on the shop page | The storefront script counts product views, try-on taps, baskets and purchases — no cookies, nothing that identifies a shopper, silent for anyone who asked not to be tracked. Fixed the same day: a browser rule would have made it lose every event on a real shop; now proven working across sites |
| ✅ | P4.4 The numbers behind the screen | The dashboard reads daily totals only, and shows the try-on uplift only when there are at least 100 sessions on each side |
| ✅ | P4.5 Analytics screen | The analytics screen on real numbers, in Arabic and English, with a note when there is no data yet |
| ✅ | P4.6 Does try-on sell more? | Shoppers who tried on and those who didn't, side by side, and whether the difference could just be chance |
| ◐ | P4.8 Exports | Download the daily figures as a spreadsheet file — done. Weekly emails wait on live email sending |
| ⬜ | P4.2 / P4.3 Receiving and adding up events | The other session's part; planned in detail, waiting on its go-ahead |

## P3 — 3D models from photos (started 2026-09-27)

| | Package | In plain words |
|---|---|---|
| ✅ | P3.2 Job tracking | When a merchant asks for a 3D model, the job is charged once, shows its progress (never going backwards), and can be cancelled at any time — credits come back if it hadn't started, and are kept once the provider is working (your decision). It is stopped and refunded automatically if it ever gets stuck, and refunded if it fails. The merchant sees a clear message if it fails, never the provider's technical error. **Nothing generates a model yet** — that needs a 3D provider account |
| ✅ | P3.3 Photo intake & checks | A merchant uploads a product's photos — front, side, back and up to three close-ups — and each is checked from the file itself before any credits are spent: JPG, PNG or WebP (iPhone HEIC photos are refused with how to fix it), at least 768 pixels on the short side, under 20 MB, not a panorama, not the same photo twice. A refused photo is deleted straight away with the reason in Arabic and English; photos count toward the plan's storage. Blur and lighting checks need the AI service and come later |
| ✅ | P3.5 Post-processing ⭐ | Every 3D model is made small enough for a phone: the pictures inside it are converted to WebP at the largest size that keeps the file under 2 MB (a real product model went from 8.97 MB to 509 KB and looks the same in the viewer), models with too many triangles are simplified, and Android's AR gets its own lighter copy. A generated model is also made the product's real size from your measurements and stood on the floor; if its shape doesn't agree with the measurements, it is flagged for review instead of being stretched. **Also fixed:** the storefront 3D viewer could not open any compressed model — it now can |
| ◐ | P3.7 Photo screen | On each product's page: a box per angle — front (required), side, back and up to three close-ups. Pick or drop a photo and it is uploaded and checked at once: accepted with its size and a file-quality score, or refused with the reason and a "choose another" button. Remove any photo. The page says when the product is ready to generate. **The Generate button is there but off** — it needs the 3D provider and the price per generation (below) |

## P7 — hardening

| | Package | In plain words |
|---|---|---|
| ◐ | P7.7 Security | The dashboard can no longer be shown inside another website, only runs the code we send with it (a script slipped into a page is refused by the browser), always uses a secure connection, and sign-in sessions can't be refreshed in a tight loop. A review of sign-in, store webhooks, uploads and the install checker found them already sound. Left: a check when payments arrive, and an outside security review before launch |

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
| ⬜ | 3D generation API (Meshy / Tripo3D / CSM) | Generating models from photos (P3.4 onwards) |
| ⬜ | **Hetzner server** (for Postgres) | Real sign-in, staging, anything saved outside tests |

Before paying for any of them: check the name **Tajribah** is free (`.com`, `.sa`, Salla and
Zid app names, Saudi trademark search).

**Decided 2026-09-23:**
- Database: **Postgres on a Hetzner server.** Needed from you: the server (a CX22-class
  machine is enough to start). Until it exists, sign-in cannot work in the browser.
- Arabic text uses **ASCII digits** (30, 15%) — done; a test keeps it that way.
- **Start P1 without waiting** for CI/staging — only the parts that need no account.

**Decided 2026-09-26:** start the later phases' no-account parts too (billing first).

**Decided 2026-09-26:** when a plan's price or limits change, existing subscribers **move to the new terms** (no grandfathering).

**Received 2026-09-27:** SRO Company's VAT certificate and national address — on every invoice now.

**Needed from you:** **how many AI credits one 3D generation costs.** The plans give 5 / 40 / 200 credits a month, but nothing says what a generation uses — so the Generate button can't be priced yet. (Tell me a number, e.g. 1 credit per model, or per product.)

**Decided 2026-09-27 (T24):** cancelling a 3D generation that is already running **keeps its charge**; before it starts, the credits come back.

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
| 2026-09-25 | P1.10 product page (sizes, AR switch) | 282 pass / 0 fail |
| 2026-09-25 | P1.11 store connection screen (sync now, disconnect) | 284 pass / 0 fail |
| 2026-09-25 | P1.14 model library (versions, publish, upload) | 290 pass / 0 fail |
| 2026-09-25 | P1.24 team (invitations, roles, removal) | 297 pass / 0 fail |
| 2026-09-25 | P1.25 store settings (CR/VAT, branding, consent text) | 303 pass / 0 fail |
| 2026-09-25 | P1.22 home screen on real data | 306 pass / 0 fail |
| 2026-09-25 | P1.21 AR button settings per product | 309 pass / 0 fail |
| 2026-09-25 | P1.23 notifications + quick search | 314 pass / 0 fail |
| 2026-09-25 | P1.16 AR button script for storefronts (2.7 KB, can't break the shop) | 318 pass / 0 fail |
| 2026-09-25 | P1.17 install snippet + checker; all screens fit phones | 322 pass / 0 fail |
| 2026-09-25 | P1.18 AR on phones — all no-account parts of P1 now done | 325 pass / 0 fail |
| 2026-09-26 | Fixes from the backlog: duplicate jobs, sidebar by role, abandoned uploads, why a model failed, encryption key rotation, webhook retry pacing and fairness, invitation email language | 338 pass / 0 fail |
| 2026-09-26 | P1.2 setup guide, email confirmation and password reset screens; two-factor sign-in split off as P1.2b | 348 pass / 0 fail |
| 2026-09-26 | Windows line-ending fix (`.gitattributes`) · P1.2b two-step sign-in (authenticator app + backup codes) | 363 pass / 0 fail |
| 2026-09-26 | **P2 opened** (your call). P2.1 plans in the database | 366 pass / 0 fail |
| 2026-09-26 | Your call recorded: plan changes apply to everyone. P2.2 usage counting; uploads checked against storage | 371 pass / 0 fail |
| 2026-09-26 | SRO Company recorded as the seller. P2.6 invoices (numbering, VAT, bilingual printable invoice) | 377 pass / 0 fail |
| 2026-09-26 | P2.9 AI credits ledger (monthly grants, expiry, purchases, refunds — each once) | 381 pass / 0 fail |
| 2026-09-26 | P2.11 trial end: read-only everywhere, banner, reminders | 386 pass / 0 fail |
| 2026-09-26 | P2.10 billing screen on real data, checkout up to payment | 389 pass / 0 fail |
| 2026-09-26 | P2.12 discount codes; database security rules now cover tables added later | 395 pass / 0 fail |
| 2026-09-26 | P2.13 billing messages (invoice issued, payment failed) | 397 pass / 0 fail |
| 2026-09-26 | Staff console opened: A1 who can get in, staff activity record | 399 pass / 0 fail |
| 2026-09-26 | A2 platform overview for staff | 400 pass / 0 fail |
| 2026-09-26 | A3 stores list and store page for staff | 402 pass / 0 fail |
| 2026-09-27 | A4 store actions for staff | 405 pass / 0 fail |
| 2026-09-27 | A5 people for staff | 408 pass / 0 fail |
| 2026-09-27 | A6 plans and pricing for staff | 411 pass / 0 fail |
| 2026-09-27 | A7 subscriptions and invoices for staff (view) | 413 pass / 0 fail |
| 2026-09-27 | A11 platform operations | 416 pass / 0 fail |
| 2026-09-27 | A12 support tooling | 419 pass / 0 fail |
| 2026-09-27 | A13 coupons for staff | 421 pass / 0 fail |
| 2026-09-27 | A4b view as the store | 423 pass / 0 fail |
| 2026-09-27 | SRO Company VAT + National Address on invoices | 423 pass / 0 fail |
| 2026-09-27 | A14 privacy requests and retention | 427 pass / 0 fail |
| 2026-09-27 | A13 announcements | 429 pass / 0 fail |
| 2026-09-27 | Your company's legal details in the website footer and legal pages | site preview |
| 2026-09-27 | Website: Salla and Zid pages, help centre, blog, customer stories (marked illustrative), careers | site preview |
| 2026-09-27 | Website pricing: monthly / yearly switch (a year costs ten months) and a calculator that shows when the plan pays for itself, on your visitor's own numbers | site preview, phone and desktop, Arabic and English |
| 2026-09-27 | Website: a page for each way to try — on the model, on your own photo, true-size comparison, phone hand-off — each saying plainly what it does not do | site preview, phone and desktop, Arabic and English |
| 2026-09-27 | P4.1 the measuring part: the storefront script now counts product views, try-on taps and (when your store tells it) baskets and purchases — without cookies, without anything that identifies a shopper, and silent for anyone who has asked not to be tracked | 440 pass / 0 fail, and seen working in a real shop page |
| 2026-09-27 | Security: the dashboard can no longer be shown inside another website (a trick used to make people click things they cannot see), browsers are told to always use a secure connection, and signing-in sessions can no longer be refreshed in a tight loop | 449 pass / 0 fail, and the new headers seen on the running app |
| 2026-09-27 | Security: every dashboard page now only runs the code we sent with it. If someone slips a script into a page (for example through a product name), the browser refuses to run it | 452 pass / 0 fail; checked in a real browser, including a script planted on purpose and blocked |
| 2026-09-27 | 3D generation, the part that needs no provider: a generation job is charged once, shows its progress, can be cancelled at any time with your credits returned, and is stopped and refunded if it ever gets stuck. One choice for you: when you cancel a job that is already running, this build returns all your credits and Tajribah pays the provider (decision T24) | 461 pass / 0 fail |
| 2026-09-27 | Your decision applied: cancelling a 3D generation that is already running keeps its charge. This page brought up to date — the top had not changed since the 26th | 3D job tests 9 / 9 |
| 2026-09-27 | Product photos for 3D generation: upload, automatic checks on each photo (format, size, duplicates), refused photos deleted at once with the reason, counted in storage | 474 pass / 0 fail; checked on real product photos in 7 file types |
| 2026-09-28 | The photo screen for 3D generation on every product page: add, see checked, remove, retry — Arabic and English, phone and desktop | 477 pass / 0 fail; driven in a real browser with real product photos |
| 2026-09-28 | 3D models under 2 MB for real (8.97 MB → 509 KB on a real product model, same look), generated models made true to size, and the storefront viewer fixed so it can open compressed models at all | 484 pass / 0 fail; rendered side by side in the real 3D viewer |
