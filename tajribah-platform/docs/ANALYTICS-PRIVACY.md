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

## The privacy policy — to bring in line (Nader)

The website's privacy policy (`tajribah-try-on/content/legal.ts`) describes "Studio usage data" and,
under Retention, "Usage statistics: aggregated and not tied to individuals". Since P4.2–P4.10 that
is incomplete: events from **product pages** are kept **per visit for 90 days** and the merchant can
see a visit's path. Proposed wording (not applied — public legal text is Nader's to approve):

- *What we collect* — replace the studio line with: "Shop-page usage, on the merchant's behalf:
  anonymous events such as viewing a product, opening the 3D view or the try-on, adding to cart and a
  purchase's value, with device type, operating system, browser family, country and the shop page's
  address. We do not store IP addresses or browser identifiers; each visit has an id that changes
  every day and in every shop."
- *Retention* — replace the statistics line with: "Shop-page events: 90 days, then deleted; daily
  totals that are not tied to anyone are kept."
