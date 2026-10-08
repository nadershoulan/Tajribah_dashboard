# Capacity — what one server holds, measured (P7 capacity planning)

_Measured 2026-10-08 on staging (`load/ingest.mjs`, 200 test stores), which shares the production server.
Re-run the load test after any change that touches the collector, the job runner or the database._

## The set-up being measured

- **One Hetzner server** (4 cores, 8 GB) runs Postgres 18 for production (`tajribah`) and staging
  (`tajribah_staging`) side by side, plus the Node image/3D worker.
- **Cloudflare Workers** serve every request; they reach Postgres through **Hyperdrive** over a Cloudflare
  Tunnel. Each environment has two Hyperdrive links (app role, admin role).
- **Postgres allows 100 connections**, 3 reserved for the superuser.

## Connections — the first wall

| Who | Limit | Where it is set |
|---|---|---|
| Production Hyperdrive, app role | 46 | `wrangler hyperdrive update … --origin-connection-limit` |
| Production Hyperdrive, admin role | 14 | same |
| Staging Hyperdrive, app + admin | 20 + 8 | same |
| Staging database, hard cap | 30 | `alter database tajribah_staging connection limit 30` |
| Node worker | 1 per role | `db/postgres.ts` (`max: 1`) |
| Reserved / maintenance | ~7 | superuser, psql, backups |

The Hyperdrive limits must stay **below** what Postgres accepts: when they were above it (60 + 60 a link,
the default), a load run lost 10% of its writes to refused connections, and staging alone took 83 of the 100.
**Raising capacity starts here:** a larger `max_connections` (needs a Postgres restart and more memory), or
staging on its own server.

## Throughput measured

| What | Measured | Pass mark | Notes |
|---|---|---|---|
| Event ingest, sustained | **300 events/s for 10 min, 0 lost** (180,000/180,000) | zero loss | 10× the plan's 2.5M events/day (~29/s average) |
| Collector answer | median ~3 ms beyond the network; p99 ~170 ms beyond | p99 < 100 ms | the tail was measured from one home connection |
| Event ingest, burst | 3,000 events/s: connection-bound within seconds | — | needs more connections than staging may take |
| Roll-ups (daily figures) | **~100 store-days a minute** (4 jobs at a time per pass) | — | was 10 a minute one at a time |
| Analytics screens, 430k events | 0.1–5 ms each, every one index-served | — | live view, visits, a visit's path, day totals |

## What that means in stores

- **Roll-ups:** a busy store is recounted at most every 5 minutes, so ~100 a minute keeps **~500 stores with
  traffic at the same moment** current. Beyond that the figures lag (no data is lost); the fix is more
  concurrent queue consumers (`max_concurrency`) — within the connection budget above.
- **Events:** 300 events/s is **18,000 events a minute** taken with nothing lost on today's limits — the
  plan's whole platform (2.5M a day) averages ~1,700 a minute, so there is ~10× headroom at average and the
  connection budget sets the peak.
- **Storage — the real limit at plan scale:** an event costs **~0.38 KB** with its indexes (measured: 156 MB
  for 429,720 events). 2.5M events a day kept 90 days (`ANALYTICS-PRIVACY.md`) is ~225M rows, **~85 GB** —
  more than the server's whole disk (75 GB, 63 GB free on 2026-10-08). Today's free space holds ~165M events:
  90 days at up to **~1.8M events a day**. Add a volume (or a larger server) before traffic passes ~1.5M a day.

## When to act

| Signal | Action |
|---|---|
| `queue behind` warnings in the Worker logs (oldest due job > 2 min) | more queue consumers, or a bigger database |
| `too many connections` in `/var/log/postgresql/` | lower a Hyperdrive limit, or raise `max_connections` |
| Collector `background work failed` errors | the database is refusing or slow: look at connections first |
| Disk past 70% (`df -h /` on the server), or events past ~1.5M a day | add a Hetzner volume and move the Postgres data there |
| analytics_events past ~100M rows | partition by month (retention then drops a partition instead of deleting rows) |
| GCC customers asking for data residency | the KSA residency migration (P7), planned before, not during, enterprise sales |
