# Tajribah — where the build is

_Last updated: 2026-09-29 · updated after every package_

> **Now:** building every piece that needs no account, phase by phase. Two sessions work in parallel: this one (website, analytics screen, security, 3D generation) and a second one (collecting analytics from shop pages).
> **Just finished (2026-09-29):** **WooCommerce, tried on the real thing** (P6). A real WordPress with the real WooCommerce plugin, run on this machine, with 125 products — Arabic names, a price of 1,250.50, a free one, a draft, a hidden one, one without a price. The connection read every one of them exactly as the store holds them, in two pages, none twice; found only what changed when asked; and treated a wrong key as "reconnect", not an outage. WooCommerce's own approval page accepted our Connect link as built. The last step — WooCommerce handing the keys back to us — needs the dashboard live on https, so it gets its first real run on go-live day (it is on the checklist) · before that: **connect a WooCommerce store** (P6)
> **Next:** more account-free work. White-label waits on your answer below.
> **For the day the accounts exist:** `docs/GO-LIVE.md` lists every Cloudflare step the code already expects (storage, the fast config host, the dashboard, the website, DNS), each with how to check it worked.
> **Waiting on you:** **new question — white-label (Enterprise): what should shoppers see instead of Tajribah's name?** Today they see it in two places: the logo on the phone page a QR code opens, and the try-on page's title. The store's own logo and name there? Anything in the store owner's dashboard too? Also: the **Hetzner server**, and the accounts below — Salla, Cloudflare, the domain, Moyasar and a 3D-generation provider are what most of the remaining work needs.

```
P0 Foundation     ████████████████████████████░░░░  19 / 22   (+ P0.20 mostly done, 2 blocked)
P1 Core loop      █████████████████████████░░░░░░░  20 / 26   ← first sellable product · the rest needs Salla / Cloudflare / domain
P2 Billing        █████████████░░░░░░░░░░░░░░░░░░░   6 / 15   (+ 3 partly) · the rest needs Moyasar / ZATCA
P3 3D pipeline    ███████████░░░░░░░░░░░░░░░░░░░░░   4 / 12   (+ P3.7 photo screen, P3.8 editor) · the rest needs a provider, prices or caps
P4 Analytics      ███████████░░░░░░░░░░░░░░░░░░░░░   4 / 12   (+ CSV export partly) · shared with the other session
P5 Try-on         ████████████████░░░░░░░░░░░░░░░░   7 / 14   (+ watch partly) · the rest touches your studio or needs new photography
P6 AI+connectors  ████████████░░░░░░░░░░░░░░░░░░░░   6 / 16   · the rest needs AI providers or store accounts
P7 Scale          ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   0 / 13   (+ security, safe updates, rate limits, database speed, monitoring, load tests, backups: the code-level parts done)
P8 Enterprise     █████████████░░░░░░░░░░░░░░░░░░░   5 / 12
M  Marketing      ████████████████████████░░░░░░░░   9 / 12   (+ 3 partly) · the website, in tajribah-try-on
A  Admin console  ████████████████████████████░░░░  13 / 15   (+ A7 partly) · A8 payments needs Moyasar
                                            overall  93 / 169
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
| ◐ | P1.15 Publishing to your store ⭐⭐ | "Publish to the store" puts a product's button, 3D model and watch try-on on your product page; what shoppers see stays true after later changes (try-on or AR switched off, product deleted, new model, button colour, store suspended or restored) within a minute. A watch with only the try-on (no 3D model) gets its button too. Built and seen working in a real browser; it goes live once the Cloudflare account exists (the store it is kept in is Cloudflare's) |
| ✅ | P1.16 The AR button for your store ⭐⭐ | The small script that goes on your product pages: it adds the "View in your space" button in your brand colour and your store's language, and opens the 3D viewer when a shopper taps. It is small (about 6 KB compressed, since the try-on was added), loads after your page, can't be restyled by your theme or restyle it, and if anything goes wrong it simply shows no button — it can never break your shop. It goes live once the Cloudflare account and domain exist |
| ✅ | P1.23 Bell and quick search | The bell now shows real notifications — only the ones worth your attention: a sync that failed, a model ready to publish or refused, an update from your store that couldn't be processed, someone accepting your invitation. Each person has their own, and reading them doesn't mark them for others. Ctrl+K (or the search icon) jumps to any screen you're allowed to open, or to a product by name or SKU, in Arabic or English |
| ✅ | P1.21 AR button settings | For each product: the button's text in Arabic and English, its style, and where the product is placed in AR — on the floor, a wall or a table, or on the face / wrist for glasses and watches (the screen only offers what fits the product). A live preview shows the button in your brand colour. Saved here; "Publish to the store" puts them on your product page (P1.15) |
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
| ✅ | A9 AI operations | For the Tajribah team: every AI job across stores in the last 7, 30 or 90 days — by type and outcome, how long they take, what the providers charged us (in dollars) beside the credits merchants were charged (a refunded job counts zero), the latest failures in the provider's own words, jobs that went quiet (cancel one with a reason), and which stores cost the most. **No profit margin yet:** a credit has no price until buying credits exists |
| ✅ | A10 Model review queue | The staff side of P3.6: a queue of generated models waiting, sent back and approved, with a 3D viewer, the product's measurements against the model's, triangles and file size; approve or send back with a note. Recorded in the staff trail and in the store's own activity |
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
| ◐ | M12 Search engines & conversion | Sitemap, page titles and share cards done, all on **tajribah.sa** (T29). **Conversion (T32):** "Start with this plan" now opens the dashboard's sign-up at app.tajribah.sa with the plan (Enterprise: talk to sales); the install lines on the Integrations page fixed (wrong script address, no store key) and a claim of a feature that is not built removed. **Left:** the domains themselves (DNS) |

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
| ✅ | P3.6 Model review | Every generated model waits for a person at Tajribah before it can go live: staff see it in 3D next to the product's measurements (any mismatch highlighted), then approve it or send it back with a note. The merchant sees "waiting for review", "approved" or "needs changes" with the reviewer's note, and is notified. A new version is reviewed again. Your own uploads are never held (decision T25) |
| ◐ | P3.8 3D editor | Open a model from the model list ("Edit"): see it in 3D, turn it in quarter turns until it stands and faces the right way, see its real size in millimetres before and after, and optionally make it exactly the product's size. Saving makes a new version — the turn is baked into the file, so iPhone and Android AR show it the same — and the live version stays until you publish the new one. A generated model goes back to review. **Not yet:** choosing the picture shown in the model list (needs the public file server, Cloudflare) |
| ◐ | P3.7 Photo screen | On each product's page: a box per angle — front (required), side, back and up to three close-ups. Pick or drop a photo and it is uploaded and checked at once: accepted with its size and a file-quality score, or refused with the reason and a "choose another" button. Remove any photo. The page says when the product is ready to generate. **The Generate button is there but off** — it needs the 3D provider and the price per generation (below) |

## P8 — enterprise (started 2026-09-29)

| | Package | In plain words |
|---|---|---|
| ✅ | P8 Developer page | **`/developers` on the website**: keys, the API requests, limits and errors, webhook events, and a sample that checks a message's signature — every fact tested equal to the platform, the sample run against a real signature |
| ✅ | P8 Custom roles | **Roles with your own names** (Enterprise), ticking what each covers — the work only; people, settings, billing, keys and connections stay with owners and admins. Given from the Team page's role menu; changes apply at once; leaving the plan falls back to viewer; a held role cannot be deleted |
| ✅ | P8 Outgoing webhooks | **Your systems told when something changes** (Enterprise): products added, changed or deleted in Tajribah, a 3D model published, an AI job finished. Https public addresses only; a signing secret shown once; every message signed; retried for about 21 hours; an address that keeps failing is turned off and you are told; test message, recent messages, send again |
| ✅ | P8 Public API v1 | **Your other systems can read your store**: products (page by page), one product, 3D models, figures. Fixed, documented answers that only grow; 600 requests a minute per key, with the count left on every answer; a technical reference generated from the same definitions the answers are checked against |
| ✅ | P8 API keys and scopes | **Keys for your other systems** (Enterprise): named, only the permissions you tick, a lifetime; shown once, kept only as a fingerprint. A key works as the person who made it — it stops when they leave and loses what they lose — and a read-only store's keys can only read. Revoke at once, even while read-only |

---

## P7 — hardening

| | Package | In plain words |
|---|---|---|
| ◐ | P7 Zero-downtime updates | **Every database change is checked before it can ship** to be survivable by the version still running during an update: taking things away (a column, a table, a rename, a type change, making a field required) only with a written reason, once no running code uses them; never a new required field without a default; no index or check that locks a table while it builds, unless marked as a small table. Our 19 changes so far: the two it flags are from before launch. **Left:** the update runner itself, when the server exists |
| ◐ | P7 Backups and the restore drill | **A backup that proves it restores whole**: every table and row back, the protection between stores still on, one store unable to see another's data, and the time it took. Run on a real Postgres here — it passed, and six kinds of damage were each caught. Waits on: the database server, to drill on production-sized data and to choose how often and where |
| ◐ | P7 Load tests | The plan's five pre-launch load tests, each with its pass mark built in. **The queue flood runs on every change — and found a real fault** (one store's 10,000 AI jobs held every other store's back; fixed). Product pages at 5,000/s, analytics at 3,000 events/s and 500 dashboard users are written and proven to run; full size needs staging. The catalogue-sync storm waits on a real Salla connection |
| ◐ | P7 Monitoring and speed targets | **`/api/health`** (answering) and **`/api/health/ready`** (able to work: the database checked for real, 503 when it cannot) for an uptime monitor and the status page. The plan's speed targets live in the code: each request is logged with its target, and a slower one as **slow**. Waits on: a log service and an uptime monitor account (Better Stack, Axiom/Grafana) |
| ◐ | P7 Database speed | **Every list a screen reads has an index that can serve it** — five did not (products, AI jobs, the bell, a connection's syncs and webhooks); added. A test asks the database how it would run each screen's real queries and fails on any full read or sort. Waits on: real data sizes on staging to measure |
| ◐ | P7 Rate limits and abuse | **Limits now hold across every server copy** (they counted per copy before — live, none would have held); production will not start without the shared store. Hourly per-store limits on team invitations (emails), the install checker (fetches the shop) and report exports. A refusal reads "Too many requests" in your language, not a code. Waits on: the Cloudflare KV namespace (`docs/GO-LIVE.md` §3) |
| ◐ | P7.7 Security | The dashboard can no longer be shown inside another website, only runs the code we send with it (a script slipped into a page is refused by the browser), always uses a secure connection, and sign-in sessions can't be refreshed in a tight loop. A review of sign-in, store webhooks, uploads and the install checker found them already sound. Left: a check when payments arrive, and an outside security review before launch |

---

## P6 — AI and store connections (started 2026-09-28)

| | Package | In plain words |
|---|---|---|
| ✅ | P6.7 Brakes on AI spending | On the staff console's AI page: **pause a kind of AI work**, a **daily spending limit for the platform**, a **daily AI-job limit per store**. Refused before any charge, with a clear message; nothing limited until someone sets a number; every change logged with its reason |
| ✅ | P6 WooCommerce connection | **Connect a WooCommerce store from Store connections** (Pro): approve read-only access on your own WordPress site, come back, and your products sync in — then every hour. Passes the same twelve checks every store connection must pass, **and was tried on a real WooCommerce** (every product exactly as held; Arabic, halalas, drafts, hidden). If the store takes the keys back, it asks you to reconnect. The approval's last step (keys handed back to us) first runs on go-live day, over https |
| ✅ | P6.8 AI jobs screen | **Every piece of AI work for your store in one list** — the product it is for, a progress bar while it runs, what it cost in credits and whether they came back, and Cancel with an honest warning about the credits. Opened from the 3D models page and from Billing |
| ✅ | P6 Multi-store support | One sign-in, several stores. The **store name at the top of the dashboard** (it did nothing before) opens a list of your stores — your role and plan in each, read-only or suspended ones marked — and picking one opens that store with a fresh load. **Add a store** there too: a name, and it opens on **its own 14-day free trial** (your decision, T30), with you as owner, at its setup; your email must be confirmed first, 5 a day at most. Checked in a real browser, Arabic and English |
| ✅ | P6.16 Connection health | Each store connection gets a **real health score** (it always said 100 before). Signals the platform already records: access lost (score 0 — "reconnect"), the store not answering, syncs failing one after another, no good sync for three of its own sync intervals, live updates failing (10% or more, at least 3 in a day) or waiting over 15 minutes. **Healthy**, **needs attention** or **failing** — shown on the connections screen with the reasons in plain Arabic and English. Every minute the score is updated, and when a connection **gets worse** the store's people are notified once — not again while it stays the same, and not on recovery |
| ✅ | P6.9 Connector test suite ⭐ | **One set of twelve checks every store connection must pass** — Salla's when it is built, then Zid, Shopify and WooCommerce — so the fourth behaves exactly like the first. Each connection brings a stand-in store that holds a shared test catalogue (250 products: Arabic and emoji names, halalas, no price, drafts, several pictures, change-time ties) and answers in that store's own format. The checks: every product listed once and the listing ends; products edited during a sync neither duplicated nor lost; a page asked for again is the same page; "changed since" includes the exact moment; products come back exactly as the store holds them and well formed; the count is right; a missing product is "none", not an error; a revoked sign-in is recognised as revoked; **a store that is down fails loudly, never as an empty store**. Proven: our reference store passes all twelve; fifteen connections with real-world mistakes are each caught |

---

## P5 — try-on (started 2026-09-28, watches first — your decision)

| | Package | In plain words |
|---|---|---|
| ✅ | P5.1 Try-on engine core ⭐ | **Your studio, as it is**, now opens from a shop's product page: the shopper taps "Try it on your wrist", your studio opens full-screen in a frame over the page with that shop's watch, and closes back to the page. The only change to your code is an optional `product` input (without it, it is the Failet demo exactly as before — checked byte for byte, Arabic and English, model and compare modes). Your modes, poses, calibration, hand tracking, compare grid, QR pairing: untouched |
| ◐ | P5.3 Watches | Works end to end in a real browser with a test watch, true to size on the model photos too, and merchants can now set their watches up (P5.10). Publishing to the shop is built (P1.15) and seen working with your studio in a real browser; live once the Cloudflare account exists |
| ✅ | P5.7 Consent & privacy ⭐ | The try-on frame says **"Your photos are processed on your device"** above your studio, linking to the camera & photo privacy page (opens in a new tab, the shop page stays). **Proven in a real browser**: with a real wrist photo in "On me", the only things the page loaded were your studio's own hand-tracking files — no upload, no beacon, nothing carrying the photo (and the same check catches a planted upload). **Your QR promise made true**: "deleted when received, or after 30 minutes" relied on someone using the QR feature again; now a sweep runs every minute and deletes any session past its 30 minutes, with its photo. Your pairing routes and capture page are unchanged. The sweep's schedule can only be seen running once Cloudflare is set up |
| ✅ | P5.14 Try-on marketing pages | The website already had a page for each way to try (on the model, on me, true size, phone hand-off). New: the help article **"Set up a watch for the try-on"** — the steps in the dashboard, the two pictures (PNG or WebP, truly transparent, 200 px and up, 10 MB at most), **why to crop to the case's edges** (your studio takes the picture's width as the case width), what we crop and flag, lossless WebP, the case width without the crown, the Pro and Enterprise plans, the 30-day numbers. It says what the dashboard says: the button reaches the shop once settings are published. Checked on the real build, Arabic on a phone and English on a desktop, and listed for search engines |
| ✅ | P5.12 Performance | *(2026-09-28 correction: the times below are all pictures downloaded; the watch on screen, measured later, is 4.4 s slow / 2.5 s good — see the studio idea, T31.)* Measured on the production build of the site, as a phone opens the try-on from a shop page (slow network: 150 ms, 1.6 Mbps; good 4G/5G: 40 ms, 20 Mbps; phone CPU): **studio ready 5.4 s → 2.8 s** on the slow network, **1.9 s → 0.9 s** on the good one. How: the try-on page now reads the watch's settings on the server and names every picture your studio needs in the page itself, so the phone fetches them at once instead of after the scripts; merchants' pictures are stored as lossless WebP (half the size, the same pixels); the shop page warms the connection when the button appears. **Found and fixed:** the frame would have been blank on every real shop (the site refused framing everywhere, the try-on page included), and the home page had no framing protection. The QR photo sweep (P5.7) now also proven on the real build |
| ✅ | P5.9 Quality scoring | Your studio treats a picture's full width as the case width. So each uploaded watch picture is checked in the background: **empty edges cropped away** (the watch's pixels unchanged, checked one by one, PNG and WebP), and **the share of real size it shows** measured — a soft shadow or glow at the sides widens the picture, not the watch. Each picture says "True to size" or "shows at about 82% of its real size" with the fix; the watch gets a score (the worse picture). Your own pictures: 100% and 99.6%. It warns, it does not block |
| ✅ | P5.13 Try-on analytics | Each watch in **Virtual try-on** shows its last 30 days: try-ons, product views, and try-ons to views. **Analytics → Top products** gains a "Try-ons" column. Numbers come from the daily summaries the other session writes (the agreed tables), never raw events; shown to anyone who may read analytics |
| ✅ | T55 Credits per 3D generation: 10 | Your call ("make it"): one constant the server enforces; billing, the photo screen and the website say it; tested equal |
| ✅ | T54 Told when a button leaves the shop | A system withdrawal notifies whoever may publish: the product and why, or a count for several; not for the merchant's own removal or a suspension |
| ✅ | T53 Focus returns after the dialogs | Closing the shop's try-on or 3D viewer gives focus back to its button (it fell to the page body) |
| ✅ | T52 No dead menu items | "QR codes" opened "page not found"; it now says why it is waiting (the final short address); a test keeps every menu item on a real screen; the not-found page gained its heading |
| ✅ | T51 Model names follow the language | The model library and editor showed the product's Arabic name in English too; both names now come to the screen, which picks by language |
| ✅ | T50 Read-only stores lock their buttons | Save/Publish/Upload/Invite/Sync and the rest are disabled with the reason when the store is read-only or a staff view looks; browsing and Billing stay open |
| ✅ | T49 Invited people join, no empty store | Signing up from an invitation creates the account only and joins the team in the invited role; the email counts as confirmed |
| ✅ | T48 Cookie-consent shops | Install screen option: the consent-gated two lines plus the banner's one line; an answer given before the script loads is honoured (it was lost) |
| ✅ | T47 Two-step ends other sessions | Turning two-step sign-in on ends every other session of the account (a stolen one included); the screen says so |
| ✅ | T46 Delete a model or a version | Versions that are not live and whole models can be deleted; storage freed at once, files deleted (after a 10-minute grace if shoppers may hold them); a live model comes off the shop first. The versions' buttons now fit a phone |
| ✅ | T45 Install checker: no inward addresses | A domain that points at a private address is refused before anything is fetched (every redirect too); P7.7's open item |
| ✅ | T44 Plan changes reach live buttons | A staff change to a plan's features refreshes every store with something published ("on me" follows the plan) |
| ✅ | T43 Try-on reachable on every plan | The sidebar locked "Virtual try-on" for Starter and Growth (a leftover from before T33) and sent them to Billing; unlocked, with a test |
| ✅ | T42 See which products are live | Product list and product page show "Live" / "On, not published" / "Off"; the AR switch's hint corrected |
| ✅ | T41 Refund rule checkable | The staff store page shows when the store first published a button and how many are live — the refund policy's test |
| ✅ | T40 Take a product off your shop | "Remove from the store" in AR settings (confirmed; publish again any time; nothing brings it back on its own); uninstalling the app takes that store's buttons down at once, as the website promises |
| ✅ | T39 Website claims match the product | Stock sync, add-to-cart inside the studio and a studio preview in the dashboard were promised but are not built or planned — removed or corrected on five pages, with a test |
| ✅ | T38 Setup can be finished | The checklist gains "Publish to your store" (without it the last step could never complete); a watch set up for the try-on counts as the first model; the install step says two lines, not one |
| ✅ | T37 The install checker says why | Installed right → also whether this product's button is live, not published yet (link to publish), taken down, or no product has that id; two stale claims on the install screen corrected |
| ✅ | T36 No missing pictures after a swap | A live watch's replaced try-on picture is kept 10 minutes (shoppers' pages may still hold the previous version), then deleted; not-yet-published watches as before |
| ✅ | T35 Trial on Growth, plans enforced | The **free trial runs on Growth** (sync included), so setup and sign-up's promise work. Each plan is now **checked where it is used**: connecting and syncing a store platform (Salla and Zid from Growth, Shopify and WooCommerce from Pro — a store that drops a plan stops syncing, quietly), AI 3D generation (Pro, refused before any charge), analytics (basic on Starter; conversion reports, the funnel, top products and export from Growth). A trial store gets Growth's AI credits too |
| ✅ | T33 Plans made consistent | **Every plan** sets watches up for your studio (it was Pro only, while the website promised on-the-model and size comparison to all); **on me** — the shopper's own photo — stays Pro and up, and your studio hides that tab for other shops (an optional setting; your demo unchanged, checked to the pixel). Analytics: basic on Starter, full from Growth, and the website's table now says so. A test keeps the website's plan table and the dashboard's catalogue in step |
| ✅ | P5.10 Try-on settings | **Virtual try-on** in the dashboard lists every watch. For each: upload the watch as worn and the product shot — each checked for a transparent background (a checkerboard shows it) and refused with the reason if not — enter the case width in mm (the product's width is suggested), an optional finish line in Arabic and English, and switch the "Try it on" button on once all is there. Pro plan; on other plans the screen explains and stays read-only. Pictures count toward storage |

---

## Waiting on you

**External accounts** (these are the real critical path — each takes days to approve):

| | Account | Blocks |
|---|---|---|
| ⬜ | Salla Partner + app registration | All of P1 |
| ⬜ | Cloudflare (R2, Workers, KV, DNS) | File storage, the live AR viewer |
| ⬜ | Domains: **tajribah.sa** (the website and the try-on — your decision, T29) and **tajribah.com** (the dashboard's services: configs, files, events) + a short domain | AR pages, QR codes, email links |
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

**Decided 2026-09-28 (your studio):** in "On model" mode a merchant's watch is drawn in proportion to its case width (a 38 mm watch 1.3× the 29.3 mm demo's size); the Failet demo is unchanged, checked byte for byte.

**Decided 2026-09-28 (T26):** P5 ships **watches first**, with your studio **loaded unchanged** in a frame (one added, optional `product` input).

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
| 2026-09-28 | Model review: generated models are checked by a person before going live — staff see them in 3D, approve or send back with a note; merchants see the status and the note | 486 pass / 0 fail; the review screen driven in a real browser with a real model, under the live security policy |
| 2026-09-28 | AI operations for the team: every AI job, its cost to us against the credits charged, failures, quiet jobs — with a cancel | 487 pass / 0 fail; the screen driven in a real browser, English and Arabic |
| 2026-09-28 | The 3D editor: turn a model so it stands right, see and fit its real size, save as a new version | 493 pass / 0 fail; turned a real model in the browser and the viewer's own measurement matched the page's |
| 2026-09-28 | Your try-on studio opens from a shop's product page, unchanged, with the shop's own watch | 496 pass / 0 fail; your studio proven byte-identical; tap → studio → close tested in a real browser on a real shop page |
| 2026-09-28 | Your answer applied: a merchant's watch is drawn at its true size on the model photos; your demo unchanged | the demo checked byte-identical again; a 38 mm watch seen drawn 1.3× larger |
| 2026-09-28 | The try-on settings screen: merchants set up their watches for your studio — two cut-out pictures, case width, finish, on/off | 500 pass / 0 fail; set up a watch in a real browser with your real cut-outs |
| 2026-09-28 | Try-on privacy: the frame says photos stay on the shopper's device; proven in a real browser; unpicked QR photos really deleted at 30 minutes | sweep checked on 6 kinds of leftover and seen to fail 4 ways; browser proof catches a planted upload |
| 2026-09-28 | Try-on numbers: each watch's last 30 days on the try-on screen, and a Try-ons column in top products | 501 pass / 0 fail; seen to fail 6 ways; both screens checked in a real browser, Arabic and English |
| 2026-09-28 | Try-on quality check: every watch picture checked for true size — empty edges cropped automatically, shadows and glows flagged with the size they cost | 507 pass / 0 fail; seen to fail 15 ways, including a staged race; checked in a real browser with your real pictures |
| 2026-09-28 | Try-on speed: studio ready 5.4 s → 2.8 s (slow network) and 1.9 s → 0.9 s (good 4G/5G), measured on the real build; a blank-frame bug on real shops found and fixed | 509 pass / 0 fail; 18 measured runs; the whole chain shown on an https shop page |
| 2026-09-28 | Security follow-up: the dashboard's front page `/` now gets the same protective headers as every other page (the web framework's catch-all rule skipped it) | a new test runs the framework's own rule matching over the front page, pages, the admin, files and the API |
| 2026-09-28 | A help article for merchants: setting up a watch for the try-on | checked on the real build in both languages |
| 2026-09-28 | The connector test suite: twelve checks every store connection must pass | 538 pass / 0 fail; 15 mistaken connections caught; the checks themselves seen to fail 13 ways |
| 2026-09-28 | Connection health: a real score, the reasons on screen, a notification when a connection gets worse | 541 pass / 0 fail; seen to fail 11 ways |
| 2026-09-28 | The store switcher works: pick any store you belong to | checked in a real browser with two stores |
| 2026-09-28 | Safe updates: every database change checked to be survivable while a new version rolls out | 543 pass / 0 fail; seen to fail 14 ways |
| 2026-09-28 | Your answer on the domain: the website and the try-on on tajribah.sa, the services on tajribah.com — the shop script now points there | try-on tests pass |
| 2026-09-28 | Add a store: its own 14-day trial, you as its owner (your answer) | 545 pass / 0 fail; seen to fail 9 ways |
| 2026-09-28 | Your studio idea: the watch is drawn once its two pictures are in, the rest follow — identical to the pixel; a little faster on slow networks | studio captured byte for byte before and after; measured on the real build |
| 2026-09-28 | The website leads to sign-up; its install lines fixed; one Starter name | 548 pass / 0 fail; seen to fail 7 ways; checked on the real build and in a browser |
| 2026-09-28 | Plans made consistent: every plan sets watches up; on-me stays Pro; the website's plan table matches the dashboard | 549 pass / 0 fail; seen to fail 6 ways; the studio identical to the pixel |
| 2026-09-28 | "AI product comparison" marked coming soon on the pricing page | a test keeps it from being sold as included |
| 2026-09-28 | The trial runs on Growth; plan features are enforced where they are used | 556 pass / 0 fail; seen to fail 11 ways; both analytics levels and the sign-up note checked in a browser |
| 2026-09-29 | A replaced picture of a live watch is kept 10 minutes, then deleted | 570 pass / 0 fail; seen to fail 6 ways |
| 2026-09-29 | The install checker says whether the product's button is live | 571 pass / 0 fail; seen to fail 5 ways; checked in a browser (ar 390) |
| 2026-09-29 | The setup checklist gains "Publish to your store"; a try-on watch counts as the first model | 572 pass / 0 fail; seen to fail 4 ways; checked in a browser (ar 390) |
| 2026-09-29 | Three unbuilt promises removed from the website | 573 pass / 0 fail; the guard seen to fail on the old copy; checked on the production build (ar 390) |
| 2026-09-29 | "Remove from the store"; an app uninstall takes its buttons down | 575 pass / 0 fail; seen to fail 6 ways; checked in a browser (ar 390) |
| 2026-09-29 | Staff see when a store first published (the refund rule) | 575 pass / 0 fail; seen to fail 3 ways |
| 2026-09-29 | The product list and page show which products are live on the shop | 577 pass / 0 fail; seen to fail 3 ways; checked in a browser |
| 2026-09-29 | The try-on screen is reachable from the menu on every plan | 577 pass / 0 fail; the guard seen to fail on the old menu |
| 2026-09-29 | A staff change to a plan's features refreshes published stores | 578 pass / 0 fail; seen to fail 3 ways |
| 2026-09-29 | The install checker refuses domains that point at private addresses | 579 pass / 0 fail; seen to fail 7 ways |
| 2026-09-29 | Delete a 3D model or an old version; storage freed | 582 pass / 0 fail; seen to fail 10 ways; checked in a browser (ar 390 and 1280) |
| 2026-09-29 | Turning two-step on signs the account out everywhere else | 583 pass / 0 fail; seen to fail 4 ways; checked in a browser (ar 390) |
| 2026-09-29 | Consent-banner shops: gated install lines, the banner's line, early answers kept | 586 pass / 0 fail; seen to fail 4 ways; checked in a real browser (three pages) and on the install screen (ar 390) |
| 2026-09-29 | Sign-up from an invitation joins the team with no store of its own | 587 pass / 0 fail; seen to fail 5 ways; checked in a browser (ar 390) |
| 2026-09-29 | A read-only store's change buttons are disabled with the reason | 588 pass / 0 fail; seen to fail 2 ways; checked in a browser (read-only and writable) |
| 2026-09-29 | Model list/editor product names follow the language; English pass of today's screens clean | 588 pass / 0 fail; seen to fail 1 way; checked in a browser (en 390) |
| 2026-09-29 | Accessibility sweep; the QR menu item gets its own page; every menu item tested | 589 pass / 0 fail; seen to fail 1 way; checked in a browser |
| 2026-09-29 | Shop dialogs give focus back to their button on close | 589 pass / 0 fail; checked in a real browser (old build: body; new: the button) |
| 2026-09-29 | A withdrawn button is announced in the bell | 590 pass / 0 fail; seen to fail 3 ways |
| 2026-09-29 | 10 credits per 3D generation, stated everywhere; buttons stay after a trial or subscription ends | 592 pass / 0 fail; seen to fail 2 ways |
| 2026-09-29 | The AI jobs screen: progress, cost, credits returned, cancel | 593 pass / 0 fail; seen to fail; checked in a real browser at phone width |
| 2026-09-29 | Brakes on AI spending: pause a kind of work, a platform daily spend limit, a per-store daily job limit | 599 pass / 0 fail; seen to fail 10 ways; checked in a real browser (en 1440, ar 390) |
| 2026-09-29 | Rate limits that hold across server copies; invitations, install checks and exports limited; refusals in plain words | 604 pass / 0 fail; seen to fail 11 ways |
| 2026-09-29 | Five screen lists given the index they lacked; a test checks every hot query's plan | 606 pass / 0 fail; seen to fail 8 ways |
| 2026-09-29 | API keys: scoped, shown once, acting as their maker, revocable even while read-only | 610 pass / 0 fail; seen to fail 16 ways; checked in a real browser (Enterprise en 1440 / ar 390, Growth locked) |
| 2026-09-29 | Public API v1: products, models, figures — documented shapes, per-key limit, a reference that cannot drift | 614 pass / 0 fail; seen to fail 9 ways; the reference and a keyless request seen in workerd |
| 2026-09-29 | Health endpoints for an uptime monitor; every request measured against the plan's speed targets | 618 pass / 0 fail / 0 cancelled; seen to fail 8 ways; both endpoints seen in workerd |
| 2026-09-29 | Webhooks: the page, and products, models and AI jobs announcing themselves | 634 pass / 0 fail / 0 cancelled; seen to fail 27 ways (both halves); checked in a real browser (Enterprise en 1440 / ar 390) |
| 2026-09-29 | Custom roles on the Team page — the work only, applied at once, viewer if the plan lapses | 641 pass / 0 fail / 0 cancelled; seen to fail 10 ways; checked in a real browser (Enterprise en 1440 / ar 390) |
| 2026-09-29 | The website's developer page — facts tested equal to the platform, its sample code run against a real signature | 641 + 3 pass; seen to fail 8 ways; checked in a real browser (en 1440 / ar 390) |
| 2026-09-29 | The five load tests: queue flood in the suite (found and fixed a starvation fault); three k6 scripts written and proven to run | 645 pass / 0 fail / 0 cancelled; the flood test failed on the old code, and on 2 deliberate breakages |
| 2026-09-29 | Backups proven to restore whole (the restore drill), on a real Postgres; all 27 database changes applied there too | 647 pass / 0 fail / 0 cancelled; the drill caught 6 kinds of damage |
| 2026-09-29 | WooCommerce: the connector passes the connector test suite and syncs end to end; a store revoking its keys now asks for a reconnect (any platform) | 666 pass / 0 fail / 0 cancelled; seen to fail 10 ways |
| 2026-09-29 | Connect WooCommerce from Store connections (its own approval screen); dead Connect buttons and a false "stock" claim fixed | 670 pass / 0 fail / 0 cancelled; seen to fail 6 ways; checked in a real browser (Growth locked / Pro form, ar 390, en 1440) |
| 2026-09-29 | WooCommerce tried on a real WordPress + WooCommerce (local): passed first time | 670 pass + 1 live (skipped without a store) / 0 fail |
