#!/usr/bin/env bash
# T111 — "upload to the server": the committed code to tajribah-1 (db.tajribah.org), always over `ssh tajribah`
# (the shortcut in ~/.ssh/config → root@db.tajribah.org with ~/.ssh/tajribah_hetzner; deploy/server/README.md).
#
#   bash scripts/deploy/push-server.sh             upload HEAD, install packages, switch over, check
#   bash scripts/deploy/push-server.sh --migrate   also apply pending database migrations (as postgres)
#
# Only what is committed goes up (`git archive HEAD`): never the working tree, never a git-ignored secret.
# The server's half is deploy/server/receive.sh, sent first so it always matches this repository.
# The previous version stays at /opt/tajribah/app.prev, so a bad upload is undone with
#   ssh tajribah 'cd /opt/tajribah && mv app app.bad && mv app.prev app'
set -euo pipefail
cd "$(dirname "$0")/../.."
MIGRATE="${1:-}"
REV=$(git rev-parse --short HEAD)
if [ -n "$(git status --porcelain -- .)" ]; then
  echo "note: there are uncommitted changes here — they are NOT uploaded (only $REV is)"
fi
ssh -o BatchMode=yes tajribah true || { echo "cannot reach the server with 'ssh tajribah' — see deploy/server/README.md"; exit 1; }

tr -d '\r' < deploy/server/receive.sh | ssh -o BatchMode=yes tajribah 'install -m 755 /dev/stdin /usr/local/sbin/tajribah-receive'
echo "uploading $REV to tajribah-1…"
git archive --format=tar HEAD | ssh -o BatchMode=yes tajribah tajribah-receive "$REV" "$MIGRATE"
