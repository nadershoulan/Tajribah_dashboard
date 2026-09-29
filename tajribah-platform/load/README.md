# Load tests (P7 — plan §8)

The five tests that must pass before launch, each with its pass threshold written into the test
itself. Four are [k6](https://k6.io) scripts run against staging; the queue flood runs in process on
every change. They run at the P1, P4 and P7 gates; a regression blocks the gate.

| # | Test | Where | Pass threshold | Status |
|---|---|---|---|---|
| 1 | **Viewer path** — 5,000 rps, 10 min, edge config + CDN | `viewer.js` | config p95 < 50 ms; model download start p95 < 200 ms; < 0.1% failed | Written; run locally against the real config-host Worker (50 rps). Full size needs Cloudflare (KV + CDN) |
| 2 | **Event ingest** — 3,000 events/s, zero loss, rollup lag < 30 s | `ingest.js` | collector p99 < 100 ms; none refused; after the run, events stored = batches accepted × 20 | Written; needs the collector (P4.2, the other session) on staging |
| 3 | **Dashboard** — 500 merchants navigating | `dashboard.js` | reads p95 < 300 ms; writes p95 < 800 ms; < 0.1% reads failed | Written; needs staging (a database host) and test accounts |
| 4 | **Sync storm** — 50 stores full-syncing 5,000 products each | — | — | Waits on a real store connector (Salla, P1.4) and staging: a storm against a test double measures the double |
| 5 | **Queue flood** — 10,000 3D jobs at once, fair, no starvation | `server/core/jobs/__tests__/queue-flood.test.ts` | the flooding store never over its 20% of a batch; everyone else's jobs claimed within 4 batches | **Runs in the suite, passes.** It found the starvation it guards against (below) |

## Running

k6 is a single binary (`k6 run …`); nothing here is installed by `pnpm install`.

```sh
# 1 — viewer path (TARGETS: store/product-ref pairs with a published config)
k6 run load/viewer.js -e CFG_BASE=https://cfg.tajribah.com -e TARGETS=failet/820241410,failet/820241411

# 2 — event ingest (STORES: test store keys; see the note in the script about the per-store limit)
k6 run load/ingest.js -e EV_BASE=https://ev.tajribah.com -e STORES=load-01,load-02,…

# 3 — dashboard (ACCOUNTS: a JSON file of staging test merchants, one per virtual user)
k6 run load/dashboard.js -e APP_BASE=https://staging.app.tajribah.sa -e ACCOUNTS=./accounts.json
```

Every script takes `RATE`/`USERS` and `DURATION` to run smaller. k6 exits non-zero (99) when a
threshold is crossed, so a CI job fails on its own. `viewer.js` takes `CHECK_MODELS=false` for a run
without the CDN — then its model threshold passes with no samples, so a real gate run keeps it on.

## What the queue flood found (2026-09-29)

`claim()` ranked only the oldest `limit × 10` queued jobs. A store that queued 10,000 jobs filled
that window by itself: each batch then took two of its jobs and nothing else, and every other store
waited for the whole flood to drain — about 5,000 batches. Jobs are now ranked within their store
across everything due, and each store's share is taken before any row is locked.
