# تجربة Tajribah — website and try-on studio

The Arabic-first website that sells Tajribah (tajribah.org), and the try-on studio that shoppers open
from a store's product page. Arabic is the default language; English is remembered in the
`tajribah-lang` cookie. Failet appears only as a labelled, illustrative example store.

**Where it lives (since 2026-10-04):** inside the platform — this folder holds its code (imported as
`@site/…`), `../app/(site)/` its pages, `../public/assets` and `../public/wasm` its files. It is served
by the platform's one Worker: the website at `/`, the dashboard at `/dashboard`.

**How to run it on your computer:** [`../docs/RUNNING-LOCALLY.md`](../docs/RUNNING-LOCALLY.md). The
static preview: `node site/preview/build.mjs` → `dist-site-preview/`.

**Rules for changing anything here:** [`CLAUDE.md`](CLAUDE.md) — above all, the try-on studio is the
owner's code (changes only by adding), and every product, hand, face or model is a real photograph
(where each came from, and its licence: [`ASSETS.md`](ASSETS.md)).

## Pages

| Route | Page |
|---|---|
| `/` | Home, with the live hero |
| `/demo` | The try-on studio on five example products — watch, glasses, ring, necklace, bag: on a model, on your own photo, and beside things you know the size of |
| `/features`, `/features/[slug]` | What each way of trying does, and does not |
| `/industries/[slug]` | Watches, jewellery, eyewear, bags — what works today |
| `/how-it-works` `/integrations` `/salla` `/zid` `/pricing` `/partners` `/developers` | Selling pages |
| `/about` `/careers` `/customers` `/blog` `/faq` `/help` `/contact` | Company, articles, help centre |
| `/privacy` `/try-on-privacy` `/terms` `/refund` `/cookies` | Policies (drafts awaiting Saudi-licensed counsel) |
| `/embed/try-on` | The studio as a store's product page opens it, in a frame |
| `/p/[store]/[product]` | A product's own page — one link to share, from the dashboard |
| `/capture/[token]` | The phone side of the QR hand-off |
| `/api/pair*` | The QR hand-off's photo transfer (30-minute sessions) |

## Where things live

- `components/pages/*` — one component per page, shared by the Next app and the static preview
- `components/site/*` — header, footer, consent banner, the live hero
- `components/studio/Studio.tsx` — **the try-on studio** (the owner's code — read `CLAUDE.md` first)
- `lib/demo-product.ts` — the five example products, the model photos and their measured poses
- `lib/tryon-config.ts`, `lib/hosted-page.ts` — reading a store's published product (what the shop's button opens)
- `lib/site.ts` — company details (empty placeholders until the real ones are given), navigation, page titles
- `lib/security.ts`, `proxy.ts` — each page's security policy
- `lib/analytics.ts`, `lib/page-events.ts` — website analytics (GA4, behind consent) and product-page visits
- `content/*` — every text: features, industries, help articles, policies, partner terms
- `public/assets/` — the real photos, cut-outs and on-device detection models (`ASSETS.md`)
- `scripts/cut-*.mjs` — how each product cut-out was made from its photo, so it can be made again

## Static preview

`node preview/build.mjs --modules ../tajribah-platform/node_modules` builds `dist-preview/`: the same
pages with `#/` addresses and no server (the QR hand-off and saving a picture are off there). Serve the
folder over http — opened as a file it stays blank.

## Phone hand-off (QR) on this machine

The photo transfer uses the R2 binding. Locally, `wrangler dev` keeps it on disk under `--persist-to`;
**that path must be short on Windows** — a long one (like a deep temp folder) makes every storage call
fail with workerd's "internal error", and `/api/pair` answers 503. Use the project's own folder:

```sh
node node_modules/vinext/dist/cli.js build
node ./node_modules/wrangler/bin/wrangler.js dev --config dist/server/wrangler.json --local --persist-to .wrangler/state --ip 127.0.0.1 --port 8798
node scripts/qr-e2e/qr-e2e.mjs   # computer opens the QR, a phone page sends the real wrist photo, the computer receives it
```

## Site analytics (GA4)

Off until a GA4 measurement id (`G-…`) is set — by staff in the dashboard's console (**Website**), which
publishes it to the config host; this site reads it at run time (`lib/site-settings.ts`, once a minute).
`NEXT_PUBLIC_GA_ID` is only the fallback. With an id, website pages show an Arabic-first consent banner;
Google's script loads only after "Accept" (Consent Mode v2, ads always denied), "Cookie settings" in the
footer reopens the choice, and the cookie and privacy policies switch to the wording that names Google
Analytics. A product's own page (`/p/…`) never uses this id: it may load **its store's** GA4, behind a
banner naming the store. The try-on frame and the phone capture page never load any.
Code: `lib/analytics.ts`, `lib/site-settings.ts`, `components/site/consent.tsx`; decisions T68, T69.
