#!/usr/bin/env bash
# T111 — the server's half of scripts/deploy/push-server.sh: reads the code (a tar of HEAD) on stdin and switches
# /opt/tajribah/app over to it. Sent to /usr/local/sbin/tajribah-receive on every upload, so it follows the repo.
#
#   git archive HEAD | ssh tajribah tajribah-receive <revision> [--migrate]
set -euo pipefail
REV="${1:?revision}"
MIGRATE="${2:-}"
cd /opt/tajribah
rm -rf app.new && mkdir app.new
tar -x -C app.new
echo "$REV" > app.new/REVISION
# Start from the current packages, so the install only adds what changed.
if [ -d app/node_modules ]; then cp -a app/node_modules app.new/; fi
chown -R tajribah:tajribah app.new
( cd app.new && sudo -u tajribah -H npm install --no-audit --no-fund --no-package-lock --loglevel=error >/dev/null )
rm -rf app.prev
if [ -d app ]; then mv app app.prev; fi
mv app.new app
# The server's units follow the repository.
for unit in app/deploy/server/*.service app/deploy/server/*.timer; do
  if [ -e "$unit" ]; then install -m 644 "$unit" /etc/systemd/system/; fi
done
systemctl daemon-reload
if [ "$MIGRATE" = "--migrate" ]; then
  ( cd app && sudo -u postgres node scripts/db/migrate.mjs --db tajribah | tail -3 )
else
  ( cd app && sudo -u postgres node scripts/db/migrate.mjs --db tajribah --status | tail -1 | sed 's/^/migrations: /' )
fi
# What runs from this code picks it up.
for svc in tajribah-worker; do
  if systemctl is-enabled --quiet "$svc" 2>/dev/null; then systemctl restart "$svc" && echo "restarted $svc"; fi
done
node -e "require('/opt/tajribah/app/node_modules/sharp'); console.log('packages ok (sharp loads)')"
echo "live: $(cat app/REVISION) · previous kept at /opt/tajribah/app.prev ($(cat app.prev/REVISION 2>/dev/null || echo 'first upload'))"
