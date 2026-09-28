/**
 * P5.7 — make the privacy promise true: a QR-transferred photo that is never received is gone
 * within a minute of its session expiring (Nader, 2026-09-28: "Add a scheduled sweep").
 *
 * The pairing routes delete a photo the moment the computer receives it, and remove an expired
 * session when someone opens it or starts a new one. With no traffic at all, nothing ran — so an
 * abandoned photo could stay. This runs on a schedule (`worker/index.ts`, every minute — the site promises
 * "deleted when received, or after 30 minutes", so a longer interval would break it) and
 * uses the pairing's own `removeSession`; `/api/pair*` and the capture page are unchanged.
 */
import { SESSION_MS, bucket, removeSession, validToken } from './pair-store';

type Listing = { objects: { key: string; uploaded: Date }[]; truncated: boolean; cursor?: string };
export type SweepBucket = {
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<Listing>;
  get(key: string): Promise<{ json<T>(): Promise<T> } | null>;
};

/** Every expired session (and its photo), and any photo whose session is gone and is older than a session. */
export async function sweepExpiredPairs(now = Date.now(), store: SweepBucket = bucket(), remove: (token: string) => Promise<void> = removeSession): Promise<{ sessions: number; orphans: number }> {
  let sessions = 0;
  let orphans = 0;
  const live = new Set<string>();
  for (let cursor: string | undefined; ;) {
    const page = await store.list({ prefix: 'sessions/', limit: 1000, cursor });
    for (const object of page.objects) {
      const token = object.key.slice('sessions/'.length, -'.json'.length);
      if (!validToken(token)) continue;
      const session = await store.get(object.key);
      const expiresAt = session ? (await session.json<{ expiresAt?: number }>()).expiresAt : undefined;
      // A session without a readable expiry is judged by its age, as the pairing's own cleanup does.
      const expired = typeof expiresAt === 'number' ? now > expiresAt : object.uploaded.getTime() < now - SESSION_MS;
      if (expired) { await remove(token); sessions++; } else live.add(token);
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  for (let cursor: string | undefined; ;) {
    const page = await store.list({ prefix: 'photos/', limit: 1000, cursor });
    for (const object of page.objects) {
      const token = object.key.slice('photos/'.length, -'.jpg'.length);
      if (!validToken(token) || live.has(token)) continue;
      if (object.uploaded.getTime() < now - SESSION_MS) { await remove(token); orphans++; }
    }
    if (!page.truncated) break;
    cursor = page.cursor;
  }
  return { sessions, orphans };
}
