/**
 * T139 — several photos from the phone in one pairing: each waits under its own key, the computer takes the oldest and
 * deletes it at once, the session stays open for the next; at most MAX_WAITING wait.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_WAITING, PHOTO_HEADER, addPhoto, newPhotoId, nextPhoto, photoKey, removePhotos, tokenOfPhotoKey, validPhotoId, waitingPhotos, type PhotoStore } from '@site/lib/pair-photos';

const TOKEN = 'a'.repeat(32);
const JPEG = new Uint8Array([255, 216, 255, 1]);

/** A stand-in for the bucket: keys in a map, with what was put. */
function store() {
  const objects = new Map<string, { bytes: Uint8Array; meta?: Record<string, string> }>();
  const deleted: string[] = [];
  const s: PhotoStore = {
    put: async (key, bytes, o) => { objects.set(key, { bytes, meta: o?.customMetadata }); },
    list: async ({ prefix }) => ({ objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }),
    delete: async (keys) => { for (const k of [keys].flat()) { deleted.push(k); objects.delete(k); } },
  };
  return { s, objects, deleted };
}

test('a photo’s id says when it was sent: later ones sort after, and only such ids are accepted', () => {
  const a = newPhotoId(1_791_800_000_000, () => 0), b = newPhotoId(1_791_800_000_001, () => 0.99);
  assert.ok(validPhotoId(a) && validPhotoId(b));
  assert.ok(a < b, `${a} before ${b}`);
  assert.equal(newPhotoId(5, () => 0).length, 13, 'always the same length, so ids sort as text');
  for (const bad of ['', '../x', 'ZZZZZZZZZZZZZ', 'abc', `${a}x`]) assert.equal(validPhotoId(bad), false, bad);
  assert.equal(photoKey(TOKEN, a), `photos/${TOKEN}/${a}.jpg`);
});

test('photos wait in the order sent; the session takes more after the first; at most MAX_WAITING wait', async () => {
  const { s, objects } = store();
  const first = await addPhoto(s, TOKEN, JPEG, '0.5,0.5,0.2,10', 1000);
  const second = await addPhoto(s, TOKEN, JPEG, null, 2000);
  assert.ok('id' in first && 'id' in second);
  assert.deepEqual(await waitingPhotos(s, TOKEN), [first.id, second.id], 'oldest first');
  const shuffled = store(); // listed in another order: still oldest first
  const late = await addPhoto(shuffled.s, TOKEN, JPEG, null, 5000), early = await addPhoto(shuffled.s, TOKEN, JPEG, null, 4000);
  assert.ok('id' in late && 'id' in early);
  assert.deepEqual(await waitingPhotos(shuffled.s, TOKEN), [early.id, late.id]);
  assert.deepEqual(objects.get(photoKey(TOKEN, first.id))!.meta, { pose: '0.5,0.5,0.2,10' }, 'the shopper’s fit kept with its photo');
  assert.equal(objects.get(photoKey(TOKEN, second.id))!.meta, undefined, 'none sent: none kept');
  for (let i = 2; i < MAX_WAITING; i++) assert.ok('id' in (await addPhoto(s, TOKEN, JPEG, null, 3000 + i)));
  assert.deepEqual(await addPhoto(s, TOKEN, JPEG, null, 9999), { full: true }, 'one more than MAX_WAITING: refused');
  // another session's photos are not counted, and odd keys are ignored
  objects.set(`photos/${TOKEN}/not-a-photo.jpg`, { bytes: JPEG });
  objects.set(`photos/${'b'.repeat(32)}/${newPhotoId(1)}.jpg`, { bytes: JPEG });
  assert.equal((await waitingPhotos(s, TOKEN)).length, MAX_WAITING);
});

test('ending a session takes all its photos (and the one-photo key of before)', async () => {
  const { s, objects, deleted } = store();
  await addPhoto(s, TOKEN, JPEG, null, 1);
  await addPhoto(s, TOKEN, JPEG, null, 2);
  objects.set(`photos/${'b'.repeat(32)}/${newPhotoId(3)}.jpg`, { bytes: JPEG });
  await removePhotos(s, TOKEN);
  assert.deepEqual(await waitingPhotos(s, TOKEN), []);
  assert.ok(deleted.includes(`photos/${TOKEN}.jpg`), 'the old single key too');
  assert.equal(objects.size, 1, 'another session’s photo stays');
});

test('the sweep knows a stored photo’s session, in either shape', () => {
  const id = newPhotoId(1);
  assert.equal(tokenOfPhotoKey(`photos/${TOKEN}/${id}.jpg`), TOKEN);
  assert.equal(tokenOfPhotoKey(`photos/${TOKEN}.jpg`), TOKEN, 'before T139');
  for (const bad of [`photos/${TOKEN}/x.jpg`, `photos/short/${id}.jpg`, `sessions/${TOKEN}.json`, `photos/${TOKEN}/${id}.png`]) assert.equal(tokenOfPhotoKey(bad), null, bad);
});

test('the computer takes the oldest waiting photo, with its fit, and deletes it there at once; nothing waiting: nothing; ended: says so', async () => {
  const calls: string[] = [];
  const older = newPhotoId(1000), newer = newPhotoId(2000);
  const get = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (init?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith(`?image=${older}`)) return new Response(new Blob([JPEG]), { headers: { 'X-Tajribah-Pose': '0.4,0.6,0.3,-20', [PHOTO_HEADER]: older } });
    return Response.json({ ready: true, photos: [older, newer], expiresAt: 9e15 });
  }) as typeof fetch;
  const got = await nextPhoto('p1', get);
  assert.ok(got && got !== 'expired');
  assert.equal(got.pose, '0.4,0.6,0.3,-20');
  assert.deepEqual([...new Uint8Array(await got.blob.arrayBuffer())], [...JPEG]);
  assert.deepEqual(calls, ['GET /api/pair/p1', `GET /api/pair/p1?image=${older}`, `DELETE /api/pair/p1?image=${older}`], 'the oldest, then deleted — the session itself stays');
  const none = (async () => Response.json({ ready: false, photos: [] })) as unknown as typeof fetch;
  assert.equal(await nextPhoto('p1', none), null);
  const gone = (async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
  assert.equal(await nextPhoto('p1', gone), 'expired');
  const odd = (async () => Response.json({ ready: true, photos: ['../../etc'] })) as unknown as typeof fetch;
  assert.equal(await nextPhoto('p1', odd), null, 'an id that is not one is never asked for');
});
