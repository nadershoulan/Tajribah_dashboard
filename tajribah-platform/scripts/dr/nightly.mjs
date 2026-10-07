#!/usr/bin/env node
/**
 * P7 / T108 — the database's own backups, in place of the host's disk snapshots (Nader's choice):
 * every night a checked dump (`drill.mjs backup`), on Sundays also restored into a scratch database and
 * checked (`drill.mjs verify`), then sealed to the backup public key (`seal.mjs`) and sent to the
 * private R2 bucket `tajribah-backups` — off the server, so losing the server loses no data. Older
 * copies are pruned: every night for 14 days, then one a week for 8 weeks.
 *
 *   node scripts/dr/nightly.mjs run [--verify]        the nightly job (systemd: deploy/server/tajribah-backup.timer)
 *   node scripts/dr/nightly.mjs keygen                once, on the owner's computer: the key pair
 *   node scripts/dr/nightly.mjs list                  what the bucket holds
 *   node scripts/dr/nightly.mjs fetch --key <stored key> --out <dir> [--private <pem file>]
 *                                                     download and open one backup (dump + manifest), ready
 *                                                     for `drill.mjs verify` or `pg_restore`
 *
 * Settings come from the environment (on the server: /etc/tajribah/backup.env, read by the systemd unit):
 *   BACKUP_DB_URL            the tajribah_admin login (pg_dump needs every row; RLS does not apply to it)
 *   BACKUP_VERIFY_SERVER     a maintenance database on the same server (e.g. …/postgres) for Sunday's restore check
 *   BACKUP_R2_ACCOUNT_ID, BACKUP_R2_BUCKET (default tajribah-backups), BACKUP_R2_ACCESS_KEY_ID, BACKUP_R2_SECRET_ACCESS_KEY
 *                            an R2 token for that bucket only (Object Read & Write)
 *   BACKUP_PUBLIC_KEY_FILE   default deploy/server/backup-public.pem (committed: it can only encrypt)
 * Exit 1 on any failure, with one line saying which step — systemd records it (`systemctl status tajribah-backup`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { backupKeyPair, open, seal, toPrune } from './seal.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const env = process.env;
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const PREFIX = 'db/';

async function bucket() {
  for (const k of ['BACKUP_R2_ACCOUNT_ID', 'BACKUP_R2_ACCESS_KEY_ID', 'BACKUP_R2_SECRET_ACCESS_KEY']) if (!env[k]) throw new Error(`settings: ${k} is not set`);
  const { signRequest } = await import(pathToFileURL(path.join(ROOT, 'server/core/storage/sigv4.ts')).href);
  const base = `https://${env.BACKUP_R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.BACKUP_R2_BUCKET ?? 'tajribah-backups'}`;
  const send = async (method, key = '', { body, query = {} } = {}) => {
    const url = new URL(`${base}${key ? `/${key.split('/').map(encodeURIComponent).join('/')}` : ''}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const payloadHash = body ? createHash('sha256').update(body).digest('hex') : undefined;
    const headers = await signRequest({ method, url, region: 'auto', accessKeyId: env.BACKUP_R2_ACCESS_KEY_ID, secretAccessKey: env.BACKUP_R2_SECRET_ACCESS_KEY, ...(payloadHash ? { payloadHash, headers: { 'content-type': 'application/octet-stream' } } : {}) });
    const res = await fetch(url, { method, headers, ...(body ? { body } : {}) });
    if (!res.ok) throw new Error(`storage ${method} ${key || '(list)'}: ${res.status} ${/<Code>([^<]+)/.exec(await res.text())?.[1] ?? ''}`);
    return res;
  };
  return {
    put: (key, body) => send('PUT', key, { body }).then((r) => r.body?.cancel()),
    get: async (key) => Buffer.from(await (await send('GET', key)).arrayBuffer()),
    del: (key) => send('DELETE', key).then((r) => r.body?.cancel()),
    async list() {
      const keys = [];
      let token;
      do {
        const xml = await (await send('GET', '', { query: { 'list-type': '2', prefix: PREFIX, 'max-keys': '1000', ...(token ? { 'continuation-token': token } : {}) } })).text();
        for (const [, k] of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(k.replace(/&amp;/g, '&'));
        token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)/.exec(xml)?.[1] : undefined;
      } while (token);
      return keys;
    },
  };
}

function drill(args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/dr/drill.mjs'), ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error((r.stderr || r.stdout).trim().split('\n').slice(-3).join(' '));
  return JSON.parse(r.stdout);
}

async function run() {
  if (!env.BACKUP_DB_URL) throw new Error('settings: BACKUP_DB_URL is not set');
  const publicPem = fs.readFileSync(env.BACKUP_PUBLIC_KEY_FILE ?? path.join(ROOT, 'deploy/server/backup-public.pem'), 'utf8');
  const store = await bucket(); // settings checked before the dump, not after
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tajribah-backup-'));
  const started = Date.now();
  try {
    let step = 'dump';
    try {
      const { file } = drill(['backup', '--db', env.BACKUP_DB_URL, '--out', dir]);
      const manifest = file.replace(/\.dump$/, '.manifest.json');
      let verified = 'not checked (Sundays)';
      if (process.argv.includes('--verify') || new Date().getUTCDay() === 0) {
        step = 'restore check';
        if (!env.BACKUP_VERIFY_SERVER) throw new Error('settings: BACKUP_VERIFY_SERVER is not set');
        const report = drill(['verify', '--dump', file, '--server', env.BACKUP_VERIFY_SERVER]);
        if (!report.ok) throw new Error(report.problems.join('; '));
        verified = `restored and checked in ${report.restoreSeconds ?? report.seconds ?? '?'} s`;
      }
      step = 'seal and upload';
      const bytes = fs.statSync(file).size;
      for (const f of [file, manifest]) await store.put(`${PREFIX}${path.basename(f)}.sealed`, seal(fs.readFileSync(f), publicPem));
      step = 'prune';
      const pruned = toPrune(await store.list());
      for (const key of pruned) await store.del(key);
      console.log(`backup ok: ${path.basename(file)}, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${verified}, ${pruned.length} old files pruned, ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (e) { throw new Error(`backup failed at ${step}: ${e.message}`); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

const command = process.argv[2];
try {
  if (command === 'run') await run();
  else if (command === 'keygen') {
    const dir = path.join(os.homedir(), '.tajribah');
    const privateFile = path.join(dir, 'backup-private.pem');
    if (fs.existsSync(privateFile)) throw new Error(`${privateFile} exists already — a new pair would make the backups sealed to the old one unreadable`);
    const { publicPem, privatePem } = backupKeyPair();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(privateFile, privatePem, { mode: 0o600 });
    fs.mkdirSync(path.join(ROOT, 'deploy/server'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'deploy/server/backup-public.pem'), publicPem);
    console.log(`private key: ${privateFile} (copy it into your password manager — without it no backup can be opened)\npublic key:  deploy/server/backup-public.pem (commit it; it can only encrypt)`);
  } else if (command === 'list') {
    for (const key of (await (await bucket()).list()).sort()) console.log(key);
  } else if (command === 'fetch') {
    const key = arg('--key'), out = arg('--out');
    if (!key || !out) throw new Error('fetch needs --key <stored key> --out <dir>');
    const privatePem = fs.readFileSync(arg('--private') ?? path.join(os.homedir(), '.tajribah', 'backup-private.pem'), 'utf8');
    const store = await bucket();
    fs.mkdirSync(out, { recursive: true });
    for (const k of [key, key.replace(/\.dump\.sealed$/, '.manifest.json.sealed')]) {
      const file = path.join(out, path.basename(k).replace(/\.sealed$/, ''));
      fs.writeFileSync(file, open(await store.get(k), privatePem));
      console.log(file);
    }
  } else {
    console.error('usage: nightly.mjs run [--verify] | keygen | list | fetch --key <k> --out <dir> [--private <pem>]');
    process.exit(2);
  }
} catch (e) { console.error(e.message); process.exit(1); }
