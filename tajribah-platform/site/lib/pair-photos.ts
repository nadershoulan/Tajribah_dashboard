/**
 * T139 — several photos from the phone in one pairing (Nader: a second photo sent to the screen said «انتهت هذه
 * الجلسة»). Before, the computer deleted the whole session the moment it took the first photo, so the phone's next send
 * found nothing. Now a session holds a queue: each photo the phone sends waits under its own key, the computer takes
 * them one by one (oldest first) and deletes each the moment it has it — "deleted once received" still holds — and
 * the session itself lives until it expires (30 minutes) or the computer ends it.
 *
 * At most `MAX_WAITING` photos wait at once (a computer that is not looking cannot make the store fill up). Pure
 * helpers and functions over a bucket-like store — R2 in the routes, a stand-in in the tests.
 */

/** Which photo a response carries — the computer deletes it by this id once it has it. */
export const PHOTO_HEADER = 'X-Tajribah-Photo';

/** Photos that may wait for the computer at once. */
export const MAX_WAITING = 10;

export type PhotoStore = {
  put(key: string, value: Uint8Array, options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> }): Promise<unknown>;
  list(options: { prefix: string; limit?: number }): Promise<{ objects: { key: string }[] }>;
  delete(keys: string | string[]): Promise<unknown>;
};

/** A photo's id: when it was sent (base 36, so ids sort by time) and four random hex digits. */
export const validPhotoId = (id: string) => /^[0-9a-z]{9}[0-9a-f]{4}$/.test(id);
export function newPhotoId(now = Date.now(), random = Math.random): string {
  return now.toString(36).padStart(9, '0').slice(-9) + Math.floor(random() * 0x10000).toString(16).padStart(4, '0');
}
export const photoPrefix = (token: string) => `photos/${token}/`;
export const photoKey = (token: string, id: string) => `${photoPrefix(token)}${id}.jpg`;
/** The session a stored photo belongs to — `photos/<token>/<id>.jpg`, or the one-photo `photos/<token>.jpg` of before. */
export function tokenOfPhotoKey(key: string): string | null {
  const m = /^photos\/([a-f0-9]{32})(?:\/[0-9a-z]{13}\.jpg|\.jpg)$/.exec(key);
  return m ? m[1]! : null;
}

/** The photos waiting for the computer, oldest first. */
export async function waitingPhotos(store: PhotoStore, token: string): Promise<string[]> {
  const { objects } = await store.list({ prefix: photoPrefix(token), limit: 1000 });
  return objects.map((o) => o.key.slice(photoPrefix(token).length, -'.jpg'.length)).filter(validPhotoId).sort();
}

/** One more photo from the phone; `full` when `MAX_WAITING` already wait. `pose`: the shopper's fit, already checked. */
export async function addPhoto(store: PhotoStore, token: string, bytes: Uint8Array, pose: string | null, now = Date.now()): Promise<{ id: string } | { full: true }> {
  if ((await waitingPhotos(store, token)).length >= MAX_WAITING) return { full: true };
  const id = newPhotoId(now);
  await store.put(photoKey(token, id), bytes, { httpMetadata: { contentType: 'image/jpeg' }, ...(pose ? { customMetadata: { pose } } : {}) });
  return { id };
}

/** Every photo of a session (and the one-photo key of before). */
export async function removePhotos(store: PhotoStore, token: string): Promise<void> {
  const keys = (await store.list({ prefix: photoPrefix(token), limit: 1000 })).objects.map((o) => o.key);
  await store.delete([...keys, `photos/${token}.jpg`]);
}

/**
 * The computer's side: the next photo waiting from the phone, if any — taken, then deleted from the session at once.
 * `expired`: the session is gone (expired or ended). `pose`: the fit the shopper left on the phone, as sent (checked by
 * the caller). One photo a call — the caller asks again for the next.
 */
export async function nextPhoto(pairId: string, get: typeof fetch = fetch): Promise<{ blob: Blob; pose: string | null } | 'expired' | null> {
  const r = await get(`/api/pair/${pairId}`, { cache: 'no-store' });
  if (r.status === 404) return 'expired';
  if (!r.ok) throw new Error('pairing unavailable');
  const id = ((await r.json()) as { photos?: string[] }).photos?.find(validPhotoId);
  if (!id) return null;
  const photo = await get(`/api/pair/${pairId}?image=${id}`, { cache: 'no-store' });
  if (photo.status === 404) return null; // taken meanwhile (another tab): the next look finds the rest
  if (!photo.ok) throw new Error('pairing unavailable');
  const blob = await photo.blob();
  const pose = photo.headers.get('X-Tajribah-Pose');
  void get(`/api/pair/${pairId}?image=${id}`, { method: 'DELETE' }).catch(() => {});
  return { blob, pose };
}
