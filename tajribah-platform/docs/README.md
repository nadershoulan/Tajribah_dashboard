# The docs — where to start

Read in this order. The first four explain the product and how to run it; the rest are reference
you open when you need them.

## Start here

| Read | It answers |
|---|---|
| [`../PROGRESS.md`](../PROGRESS.md) | **Where the build is**, in plain words: what is done, what is next, what waits on you. The top of the file is always current. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | **How it is built**: the two apps, what runs where (Cloudflare, the database, the Node worker), how one store can never see another's data. |
| [`RUNNING-LOCALLY.md`](RUNNING-LOCALLY.md) | **How to run it on your computer** — no Docker needed. |
| [`HOSTING.md`](HOSTING.md) | **Where it runs in production**, what each piece costs, and why shared hosting will not do. |

## When you set things up

| Read | It answers |
|---|---|
| [`GO-LIVE.md`](GO-LIVE.md) | The checklist for the day the accounts exist: Cloudflare, the domains, the database, each store platform — each step with how to check it worked. |
| [`DATABASE.md`](DATABASE.md) | Creating the database, updating it safely, and the two logins the app uses. |
| [`DR.md`](DR.md) | Backups, and the drill that proves a backup really restores. |

## Reference

| Read | It answers |
|---|---|
| [`DECISIONS.md`](DECISIONS.md) | Every decision that would be expensive to reverse — why it was made and how to undo it. A log: newer entries supersede older ones; the table at the top lists what is current. |
| [`PACKAGES.md`](PACKAGES.md) | The build plan broken into work packages, each with its "done when". The technical twin of PROGRESS.md. |
| [`ANALYTICS-PRIVACY.md`](ANALYTICS-PRIVACY.md) | Exactly what the shop analytics collect, keep and show, and to whom. A test fails if it falls out of step with the code. |
| [`SSO-LIVE.md`](SSO-LIVE.md), [`WOOCOMMERCE-LIVE.md`](WOOCOMMERCE-LIVE.md) | How single sign-on and the WooCommerce connection were tried against the real thing on this machine. |

## Outside this folder

- [`../STATE.md`](../STATE.md) — the builders' working log, session by session. Detailed and long; PROGRESS.md is the readable version.
- [`../CLAUDE.md`](../CLAUDE.md) — the rules every change follows.
- [`../../tajribah-try-on/README.md`](../../tajribah-try-on/README.md) — the website and the try-on studio; its [`ASSETS.md`](../../tajribah-try-on/ASSETS.md) records where every photo came from and its licence.
- `../../TAJRIBAH-BUILD-PLAN.md` — the original specification everything is built from.
