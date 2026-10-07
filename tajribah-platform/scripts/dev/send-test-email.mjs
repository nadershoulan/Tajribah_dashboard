#!/usr/bin/env node
/**
 * T112 — send one real email through the production mail settings, to check them end to end:
 *
 *   node scripts/dev/send-test-email.mjs --to info@baqah.org
 *
 * Settings: deploy/production.jsonc (host, port, mailbox, sender) and SMTP_PASSWORD from the git-ignored
 * .env.production.local. The platform's own sender (server/core/notify/smtp.ts) is bundled with esbuild and
 * runs over node:tls. Nothing secret is printed.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJsonc, readEnvFile } from '../deploy/config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const to = process.argv[process.argv.indexOf('--to') + 1];
if (!process.argv.includes('--to') || !to || !to.includes('@')) { console.error('usage: send-test-email.mjs --to <address>'); process.exit(2); }

const vars = parseJsonc(fs.readFileSync(path.join(ROOT, 'deploy/production.jsonc'), 'utf8')).vars;
const secrets = readEnvFile(fs.readFileSync(path.join(ROOT, '.env.production.local'), 'utf8'));
if (!secrets.SMTP_PASSWORD) { console.error('SMTP_PASSWORD is empty in .env.production.local — the Zoho app password goes there'); process.exit(1); }

const esbuild = createRequire(path.join(ROOT, 'node_modules', '_.js'))('esbuild');
const out = path.join(ROOT, '.tests-mail', 'mail.mjs');
await esbuild.build({
  stdin: { contents: "export { SmtpEmailSender } from './server/core/notify/smtp'; export { nodeSmtpConnector } from './server/core/notify/smtp-node';", resolveDir: ROOT, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'error',
});
const { SmtpEmailSender, nodeSmtpConnector } = await import(`file://${out.replace(/\\/g, '/')}`);
const sender = new SmtpEmailSender(
  { host: vars.SMTP_HOST, port: Number(vars.SMTP_PORT), user: vars.SMTP_USER, password: secrets.SMTP_PASSWORD, from: vars.EMAIL_FROM },
  () => nodeSmtpConnector,
);
const when = new Date().toISOString().replace('T', ' ').slice(0, 16);
await sender.send({
  to, lang: 'ar',
  subject: `تجربة — رسالة اختبار ${when}`,
  text: `مرحبًا،\n\nهذه رسالة اختبار من منصة تجربة، أُرسلت عبر Zoho من ${vars.EMAIL_FROM} في ${when} UTC.\nإن وصلتك في صندوق الوارد (لا في البريد المزعج) فالإعداد سليم.\n\n— تجربة`,
  html: `<div dir="rtl" style="font-family:Tahoma,sans-serif"><p>مرحبًا،</p><p>هذه رسالة اختبار من منصة <b>تجربة</b>، أُرسلت عبر Zoho في ${when} UTC.</p><p>إن وصلتك في صندوق الوارد (لا في البريد المزعج) فالإعداد سليم.</p><p>— تجربة</p></div>`,
});
fs.rmSync(path.dirname(out), { recursive: true, force: true });
console.log(`sent to ${to} from ${vars.EMAIL_FROM} through ${vars.SMTP_HOST}:${vars.SMTP_PORT}`);
