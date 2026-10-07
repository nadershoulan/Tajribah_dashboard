/**
 * GO-LIVE — what the deploy scripts (`upload-cdn.mjs`, `deploy-dashboard.mjs`) decide, kept apart from
 * what they do so a test can check it (`server/core/config/__tests__/deploy.test.ts`).
 */

/** Hyperdrive ids that exist only once the Hetzner server does. */
export const PLACEHOLDER = 'SET_ON_SERVER_DAY';

/** KEY=VALUE lines; `#` comments ignored, and a BOM too (`\s` matches it). */
export function readEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

/**
 * What goes where. The widget's address keeps its major version (`w/v1`) and changes in place, so it is
 * cached for five minutes; the vendor files carry their version in the name and never change.
 */
export const UPLOADS = [
  { key: 'w/v1/widget.js', from: 'widget/dist/widget.js', cache: 'public, max-age=300' },
  { key: 'vendor/model-viewer-4.0.0.min.js', from: 'public/vendor/model-viewer-4.0.0.min.js', cache: 'public, max-age=31536000, immutable' },
  { key: 'vendor/meshopt_decoder-1.2.0.js', from: 'widget/dist/vendor/meshopt_decoder-1.2.0.js', cache: 'public, max-age=31536000, immutable' },
];

/** Required in `.env.production.local` for a first launch, and why. */
export const NEEDED = {
  AUTH_SECRET: 'sign-in tokens — `openssl rand -base64 48`',
  ENCRYPTION_KEY: 'store connection tokens at rest — `openssl rand -base64 48`, a different one',
  R2_ACCESS_KEY_ID: 'direct uploads to tajribah-files (already there)',
  R2_SECRET_ACCESS_KEY: 'direct uploads to tajribah-files (already there)',
  RESEND_API_KEY: 'sign-in and invoice emails (the mail provider)',
  DATABASE_APP_URL: 'the tajribah_app login on the server (for --create-hyperdrive and the Node worker)',
  DATABASE_ADMIN_URL: 'the tajribah_admin login on the server (likewise)',
};

/** JSON with // comments (never inside strings) and trailing commas. */
export function parseJsonc(text) {
  let out = '', inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) { out += c; if (c === '\\') out += text[++i]; else if (c === '"') inString = false; continue; }
    if (c === '"') { inString = true; out += c; continue; }
    if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** The build's Worker config with production's laid over it: production wins for every key it names. */
export function assemble(built, production) {
  const merged = { ...built, ...production };
  delete merged.topLevelName; delete merged.dev; delete merged.legacy_env; // describe the local run, not a deploy
  return merged;
}

/** Placeholders still in the production config, by binding. */
export const placeholdersIn = (production) => (production.hyperdrive ?? []).filter((h) => h.id === PLACEHOLDER).map((h) => h.binding);

/** The secrets to send: what the env file holds that is not a plain var (wrangler refuses a name in both). */
export function secretsOf(fileEnv, vars) {
  // Hyperdrive replaces the database logins on the Worker, and holds the tunnel's Access token itself (T110).
  const NOT_FOR_WORKER = new Set(['DATABASE_APP_URL', 'DATABASE_ADMIN_URL', 'HYPERDRIVE_ACCESS_CLIENT_ID', 'HYPERDRIVE_ACCESS_CLIENT_SECRET']);
  return Object.fromEntries(Object.entries(fileEnv).filter(([k, v]) => v && !(k in vars) && !NOT_FOR_WORKER.has(k)));
}

/**
 * T110 — the arguments for `wrangler hyperdrive create`. With the tunnel's Access token the database is reached
 * by its tunnel hostname (pg.tajribah.org): no port, the token in place of an open 5432. Without one, a plain
 * connection string. The login comes from the URL either way.
 */
export function hyperdriveArgs(name, url, access = {}) {
  const u = new URL(url);
  const login = [`--database=${decodeURIComponent(u.pathname.slice(1))}`, `--user=${decodeURIComponent(u.username)}`, `--password=${decodeURIComponent(u.password)}`];
  if (access.id && access.secret) {
    return ['hyperdrive', 'create', name, `--host=${u.hostname}`, ...login, `--access-client-id=${access.id}`, `--access-client-secret=${access.secret}`];
  }
  return ['hyperdrive', 'create', name, `--connection-string=${url}`];
}
