# Trying the WooCommerce connector against a real WooCommerce

The connector's everyday tests use a stand-in store (`server/testing/woo-store.ts`) that answers as
the WooCommerce REST API is documented to. This is how to ask the real plugin instead — no PHP,
MySQL or Docker to install: [WordPress Playground](https://wordpress.github.io/wordpress-playground/)
runs WordPress in Node.

```sh
# 1. A real WordPress + the real WooCommerce, seeded (scripts/woocommerce-live/blueprint.json):
#    currency SAR, an Arabic product at 1,250.50 with a two-paragraph description, a free one,
#    a draft, a private one, one without a price, 120 more; and read-only REST keys
#    ck_a1a1… / cs_b2b2… (test values — this is a throwaway local site).
npx @wp-playground/cli server --port=9400 --blueprint=scripts/woocommerce-live/blueprint.json

# 2. The live test (skipped whenever WOO_LIVE_URL is not set):
WOO_LIVE_URL=http://127.0.0.1:9400 \
WOO_LIVE_KEY=ck_a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1 \
WOO_LIVE_SECRET=cs_b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2b2 \
node scripts/test.mjs --modules node_modules woocommerce-live
```

The blueprint's one test-only shim: WooCommerce accepts Basic authentication only over HTTPS, and
Playground serves plain HTTP, so a must-use plugin tells WordPress the request is HTTPS. A real store
is reached over https and needs nothing of the kind.

## Last run (2026-09-29)

WooCommerce from wordpress.org (latest), PHP 8.3, WordPress latest. Passed first time: 125 products
in 2 pages, none twice, `X-WP-Total` exact; the Arabic name and the paragraph description back as
written; 1,250.50 → 125,050 halalas; free → 0; no price → none; draft → draft; private → archived;
changed-since over the last day → all, after now → none; one product reads as it lists; an unknown id
→ none; a wrong secret → "reconnect", not a retry. Seen too: WooCommerce's own default order is newest
first (the connector asks for id order explicitly), and its approval page redirects to its login step
with our parameters, and refuses a callback that is not HTTPS — ours always is.
