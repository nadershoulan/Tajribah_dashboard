#!/usr/bin/env bash
# T109 — the database server from a fresh Ubuntu 26.04 (Hetzner CAX21, tajribah-1, db.tajribah.org).
# Safe to run again. With no host backups (T108), this script and docs/GO-LIVE "Server day" are how the
# server is rebuilt: run it, restore the latest backup (docs/DR.md), and nothing else is needed.
#
#   scp deploy/server/setup.sh root@db.tajribah.org: && ssh root@db.tajribah.org bash setup.sh
#
# What it does:
#  - every update; automatic security updates stay on (Ubuntu's unattended-upgrades)
#  - SSH by key only (no passwords, root by key only)
#  - firewall: SSH in, nothing else. Postgres listens on localhost only; Hyperdrive reaches it through a
#    Cloudflare Tunnel, so the database port is never open to the internet (T109)
#  - PostgreSQL 18 and Node 22 from Ubuntu itself (security updates come with the system)
#  - 2 GB swap, so a large picture in sharp cannot run the machine out of memory
#  - the `tajribah` system user, /opt/tajribah for the code, /etc/tajribah (root only) for settings
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

apt-get update -qq
apt-get -y -qq -o Dpkg::Options::=--force-confold full-upgrade
apt-get -y -qq install postgresql nodejs npm ufw fail2ban unattended-upgrades git rsync >/dev/null

printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' > /etc/ssh/sshd_config.d/10-tajribah.conf
mkdir -p /run/sshd # the config check needs it; a fresh 26.04 creates it only when sshd starts by socket
sshd -t
systemctl reload ssh

ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow OpenSSH >/dev/null
ufw --force enable >/dev/null

if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap -q /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

id tajribah >/dev/null 2>&1 || useradd --system --home-dir /opt/tajribah --shell /usr/sbin/nologin tajribah
install -d -o tajribah -g tajribah /opt/tajribah
install -d -m 700 /etc/tajribah
systemctl enable --now unattended-upgrades fail2ban postgresql >/dev/null 2>&1

echo "--- tajribah-1 ready"
echo "postgres: $(sudo -u postgres psql -Atc 'show server_version') listening on $(sudo -u postgres psql -Atc 'show listen_addresses')"
echo "node: $(node --version)  npm: $(npm --version)"
echo "ssh: $(sshd -T | grep -E '^passwordauthentication ' )"
echo "firewall: $(ufw status | head -1) — $(ufw status | grep -c ALLOW) rules"
echo "swap: $(swapon --show=SIZE --noheadings | tr -d ' ')"
