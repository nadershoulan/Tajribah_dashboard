#!/usr/bin/env node
/**
 * GO-LIVE §1 — put the storefront files on the public bucket (`cdn.tajribah.org`), through R2's S3 API
 * with the storage key in the git-ignored `.env.production.local` (R2_ACCOUNT_ID, R2_BUCKET_NAME,
 * R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY). Requests are signed by the platform's own SigV4
 * (`server/core/storage/sigv4.ts`). No key value is ever printed.
 *
 *   node scripts/deploy/upload-cdn.mjs [--dry-run] [--env .env.production.local]
 *
 * Builds the widget first. Then checks each file answers from https://cdn.tajribah.org with the same bytes.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readEnvFile, UPLOADS } from './config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CDN = 'https://cdn.tajribah.org';
const arg = (name) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : undefined; };
const dryRun = process.argv.includes('--dry-run');

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const envPath = path.resolve(ROOT, arg('--env') ?? '.env.production.local');
  if (!fs.existsSync(envPath)) { console.error(`no ${path.relative(ROOT, envPath)} — the storage key goes there (GO-LIVE §1)`); process.exit(1); }
  const env = readEnvFile(fs.readFileSync(envPath, 'utf8'));
  const missing = ['R2_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'].filter((k) => !env[k]);
  if (missing.length) { console.error(`missing in ${path.basename(envPath)}: ${missing.join(', ')}`); process.exit(1); }

  execFileSync(process.execPath, [path.join(ROOT, 'widget', 'build.mjs')], { stdio: 'inherit' });
  const { signRequest } = await import(pathToFileURL(path.join(ROOT, 'server/core/storage/sigv4.ts')).href);
  const endpoint = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  let failed = false;
  for (const u of UPLOADS) {
    const body = fs.readFileSync(path.join(ROOT, u.from));
    const sha = createHash('sha256').update(body).digest('hex');
    const label = `${u.key.padEnd(36)} ${(body.byteLength / 1024).toFixed(1).padStart(7)} KB`;
    if (dryRun) { console.log(`would upload ${label}`); continue; }
    const url = new URL(`${endpoint}/${env.R2_BUCKET_NAME}/${u.key}`);
    const headers = await signRequest({
      method: 'PUT', url, region: 'auto', accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': u.cache }, payloadHash: sha,
    });
    const put = await fetch(url, { method: 'PUT', headers, body });
    if (!put.ok) { console.error(`✗ ${label}  upload ${put.status} ${/<Code>([^<]+)<\/Code>/.exec(await put.text())?.[1] ?? ''}`); failed = true; continue; }
    // Read it back from the public address, past any cached 404.
    const got = await fetch(`${CDN}/${u.key}?check=${Date.now()}`);
    const same = got.ok && createHash('sha256').update(Buffer.from(await got.arrayBuffer())).digest('hex') === sha;
    console.log(`${same ? '✓' : '✗'} ${label}  ${CDN}/${u.key} → ${got.status}${same ? '' : ' (not the uploaded bytes)'}`);
    failed ||= !same;
  }
  process.exit(failed ? 1 : 0);
}
