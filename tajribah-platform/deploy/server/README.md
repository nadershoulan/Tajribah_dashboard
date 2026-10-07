# The server — tajribah-1

Hetzner CAX21 (4 Arm cores, 8 GB, 80 GB), Falkenstein, Ubuntu 26.04. It holds the database (Postgres 18), the
image/3D worker and the nightly backup. The website and dashboard run on Cloudflare Workers, not here
(docs/GO-LIVE.md).

| | |
|---|---|
| Name | `tajribah-1` — **`db.tajribah.org`** (2.31.18.118, DNS only) |
| Reaching it | **`ssh tajribah`** — always this, never a raw IP or a password |
| The code | `/opt/tajribah/app` (the version is in `REVISION`); the one before at `/opt/tajribah/app.prev` |
| Settings | `/etc/tajribah/` — root only: `db.env` (database logins), `backup.env` (backup settings) |
| Database | Postgres 18 on localhost only; Cloudflare reaches it through the tunnel `pg.tajribah.org` (T110) |
| Services | `postgresql`, `cloudflared` (the tunnel), `tajribah-backup.timer` (nightly), `tajribah-worker` (once enabled) |

## SSH — how to get in

`ssh tajribah` is a shortcut in `~/.ssh/config` on Nader's computer:

```
Host tajribah
  HostName db.tajribah.org
  User root
  IdentityFile ~/.ssh/tajribah_hetzner
  IdentitiesOnly yes
```

The key `~/.ssh/tajribah_hetzner` is the only way in. Password login is off, so keep a copy of the key in the
password manager. On another computer: copy the key file there and add the same four lines to its `~/.ssh/config`
(or run `ssh -i <key> root@db.tajribah.org`).

## Uploading to the server — always this

```sh
bash scripts/deploy/push-server.sh             # the committed code (HEAD) → tajribah-1
bash scripts/deploy/push-server.sh --migrate   # … and apply pending database migrations
```

It goes over `ssh tajribah` and uploads **only what is committed** (`git archive HEAD`), never the working tree
or a git-ignored secret, so commit first. It installs packages, switches `/opt/tajribah/app` over and installs the
systemd units from `deploy/server/`. It then lists pending migrations (or applies them with `--migrate`), restarts
what runs from the code, and prints the live revision. The server's half is `deploy/server/receive.sh`, sent anew
on every upload.

**Undo a bad upload:** `ssh tajribah 'cd /opt/tajribah && mv app app.bad && mv app.prev app'`.

## Everyday checks

```sh
ssh tajribah 'cat /opt/tajribah/app/REVISION'                    # what is live
ssh tajribah 'systemctl list-timers tajribah-backup.timer'       # next backup
ssh tajribah 'journalctl -u tajribah-backup -n 5 -o cat'         # last backup result
ssh tajribah 'systemctl is-active postgresql cloudflared'        # database and tunnel up
```

## Rebuilding from nothing

`deploy/server/setup.sh` on a fresh Ubuntu 26.04, then docs/GO-LIVE.md "Server day" and a restore from the latest
backup (docs/DR.md). No host snapshots are kept (T108); this README, `setup.sh` and the backups are the recovery plan.
