/**
 * P7 / T108 — a backup sealed to a public key, so the database server can encrypt every night yet never
 * read an old backup: the private key lives off the server (the owner's password manager, and
 * `~/.tajribah/backup-private.pem` on the computer that restores).
 *
 * X25519 with a fresh key per file → HKDF-SHA256 → AES-256-GCM. Only Node's own `crypto`; nothing to install.
 * Layout: "TJRB-BACKUP-1\n" | ephemeral public key (32) | IV (12) | ciphertext | tag (16).
 */
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';

const MAGIC = Buffer.from('TJRB-BACKUP-1\n');
const INFO = Buffer.from('tajribah-backup-v1');
/** X25519 SubjectPublicKeyInfo is this fixed prefix and the 32-byte key. */
const SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex');

const rawPublic = (key) => key.export({ type: 'spki', format: 'der' }).subarray(SPKI_PREFIX.length);
const publicFromRaw = (raw) => createPublicKey({ key: Buffer.concat([SPKI_PREFIX, raw]), format: 'der', type: 'spki' });

function keyFor(ephemeralRaw, recipientRaw, shared) {
  return Buffer.from(hkdfSync('sha256', shared, Buffer.concat([ephemeralRaw, recipientRaw]), INFO, 32));
}

/** A new key pair, both PEM: the public one goes on the server, the private one never does. */
export function backupKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }), privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

/** Encrypt `data` (a Buffer) so that only the holder of the matching private key can open it. */
export function seal(data, publicPem) {
  const recipient = createPublicKey(publicPem);
  const ephemeral = generateKeyPairSync('x25519');
  const ephemeralRaw = rawPublic(ephemeral.publicKey);
  const key = keyFor(ephemeralRaw, rawPublic(recipient), diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient }));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const body = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([MAGIC, ephemeralRaw, iv, body, cipher.getAuthTag()]);
}

/** Decrypt a sealed backup; throws on a wrong key or any changed byte. */
export function open(sealed, privatePem) {
  if (!sealed.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('not a Tajribah backup (or a newer format)');
  let at = MAGIC.length;
  const ephemeralRaw = sealed.subarray(at, (at += 32));
  const iv = sealed.subarray(at, (at += 12));
  const tag = sealed.subarray(sealed.length - 16);
  const body = sealed.subarray(at, sealed.length - 16);
  const privateKey = createPrivateKey(privatePem);
  const key = keyFor(ephemeralRaw, rawPublic(createPublicKey(privateKey)), diffieHellman({ privateKey, publicKey: publicFromRaw(ephemeralRaw) }));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]);
}

/**
 * Which stored backups to delete: keep every backup from the last `days` days, and one per week (the
 * newest of each ISO week) for `weeks` weeks. Keys carry their time — `tajribah-2026-10-07T00-00-01-123Z.dump.sealed`
 * — and a backup's dump and manifest share it, so they are kept or deleted together.
 */
export function toPrune(keys, now = new Date(), { days = 14, weeks = 8 } = {}) {
  const dated = keys.map((key) => ({ key, id: /tajribah-(\d{4}-\d{2}-\d{2}T[\d-]+Z)/.exec(key)?.[1] })).filter((k) => k.id);
  const dayOf = (id) => id.slice(0, 10);
  const ageDays = (id) => Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Date.parse(`${dayOf(id)}T00:00:00Z`)) / 86_400_000);
  const weekOf = (id) => { const d = new Date(`${dayOf(id)}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  const newestPerWeek = new Map();
  for (const { id } of dated) { const w = weekOf(id); if (!newestPerWeek.has(w) || id > newestPerWeek.get(w)) newestPerWeek.set(w, id); }
  const kept = (id) => ageDays(id) < days || (ageDays(id) < weeks * 7 && newestPerWeek.get(weekOf(id)) === id);
  return dated.filter((k) => !kept(k.id)).map((k) => k.key);
}
