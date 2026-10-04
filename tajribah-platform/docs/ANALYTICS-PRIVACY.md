# Shop analytics — what is collected, kept and shown (P4.11)

The record of how the analytics on merchants' product pages handle data. It describes the code as
built (`widget/src/events.ts`, `server/modules/analytics/`); `server/modules/analytics/__tests__/privacy.test.ts`
fails when a column is added to `analytics_events` without being described here. These are Tajribah's
working rules (T22's shape) until counsel reviews them.

**Roles (PDPL).** For shoppers on a merchant's pages, the **merchant is the controller** and Tajribah
processes on its behalf (the website's privacy policy, "Who we are"). Tajribah holds **no shopper
identity**: a privacy request from a shopper is answered "no personal data held" and pointed to the
store (T22).

## In the browser (before anything is sent)

- Nothing is sent when the browser signals Do Not Track or Global Privacy Control, or while a shop
  that set `data-tajribah-consent="required"` has not granted consent. Events refused are dropped,
  not queued.
- Only seven event kinds can leave (`product_view`, `ar_open`, `ar_place`, `tryon_start`,
  `tryon_capture`, `add_to_cart`, `purchase`), each with capped fields. The merchant's own
  `properties` lose any value that looks like an email address or a long number.
- The visit token is random, lives in `sessionStorage` (dies with the tab) — never a cookie or
  `localStorage`.

## At the collector (what arrives, what is kept, what is dropped)

The request's **IP address** is used only to rate-limit (hashed with the day, in a counter that
expires within two minutes) and is never stored. The **user agent** is reduced to a device family,
an operating system and a browser name (no versions) and then dropped. The page's **Origin/Referer**
is reduced to its host; the path and query are dropped. Robots and crawlers are not stored at all.

One row per event in `analytics_events`, and nothing else:

| Column | What it holds |
|---|---|
| `id` | A random row id |
| `tenant_id` | The store, from its public key |
| `event_type` | One of the kinds above |
| `product_id` | The store's own product, or empty when the page named none of the store's |
| `session_id` | The visit: a keyed hash of the tab's token **with the store and the Riyadh day** — the same tab tomorrow, or in another shop, is an unrelated id; it cannot be turned back into the token |
| `occurred_at` | Tajribah's clock when the batch arrived, set back by the event's place in it — the browser's clock is never stored |
| `device_type` | mobile, tablet, desktop or unknown |
| `os` | iOS, Android, Windows, macOS, ChromeOS or Linux — or empty |
| `browser` | Safari, Chrome, Edge, Firefox, Samsung Internet or Opera — or empty |
| `country`, `region` | From Cloudflare's edge (`cf-ipcountry`, `cf-region-code`) — not from the address itself |
| `referrer_host` | The host of the shop page that sent the event |
| `ar_supported` | Whether the device can show AR |
| `duration_ms` | How long a view lasted, when the page reports it |
| `value_minor`, `currency` | A purchase's value, as the merchant's page reports it |
| `properties` | Up to eight short values the merchant's page sends (filtered as above) |

## Kept for

- **Raw events: 90 days**, then deleted by the hourly retention sweep (A14, `admin/retention.ts`).
- **Daily figures** (`daily_tenant_stats`, `daily_product_stats`, `conversion_daily`,
  `device_breakdown_daily`): kept — counts per store per day, nothing per visit.
- A day older than 85 days is never recomputed, so a figure is not rewritten from partly expired events.

## Who sees what

| Who | What |
|---|---|
| Every member of the store (`analytics:read`) | The daily figures on Analytics and Home |
| Members on a plan with full analytics (Growth and up, and the trial) | Also conversion, top products, the live last half hour (P4.9) and **visit paths** (P4.10): one visit's events in order, under its daily id — no name, address or contact |
| Owner, admin, analyst (`analytics:export`) | Also the CSV export and the weekly summary email |
| Tajribah staff | Through "view as the store" only (A4b), read-only, on the staff trail |
| Another store | Nothing: every read is inside the store's row-level-security scope |

## Google Analytics (T69)

None of the above goes to Google. Separately, and only where someone chose it:
- **The website** loads GA4 under Tajribah's own id, set by staff, after the visitor accepts.
- **A product's own page** (`/p/…`) loads GA4 under **the store's** id, if the store set one, after the
  shopper accepts a banner that names the store; the choice is kept per store. The store is the
  controller of that data, as of the rest of its shoppers' data.
- **On the shop**, the widget passes four moments (`tajribah_ar_open`, `tajribah_ar_place`,
  `tajribah_tryon_start`, `tajribah_tryon_capture`, with the product id) to the Google tag the shop
  already runs. It loads nothing itself, and passes nothing it would not send to its own collector.
Ads are denied in every case, and the try-on frame and phone page never load Google Analytics.

## The privacy policy

The website's privacy policy (`site/content/legal.ts`) says this in public: shop-page events
are kept per visit for 90 days, anonymously, with no IP addresses or browser identifiers, then deleted;
daily totals tied to no one are kept. Applied on 2026-10-03 (DECISIONS T68). When this record changes,
the policy changes with it.
