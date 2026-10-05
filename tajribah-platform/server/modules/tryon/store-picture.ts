/**
 * T80 — one of the product's own store pictures as its try-on picture, instead of an upload.
 *
 * Only a picture the store gave this product (its feed's `image_link` / `additional_image_link`) can be
 * named, so this never fetches an address of the caller's choosing. It is fetched like a feed: https, a
 * public name that does not resolve to a private address (checked on every redirect, at most 3),
 * 15 seconds, at most the try-on's 10 MB. What arrives must be a PNG or WebP — a JPEG has no transparent
 * background, and the try-on needs the product cut out — and then goes through the very same check as
 * an upload (`confirmCutout`): a picture that is not a clean cut-out is refused with the reason.
 *
 * T88 — `fetchStorePhoto`: the same fetch, a JPEG accepted too, for the dashboard to take a plain
 * background off in the merchant's browser (`lib/background.ts`); what it makes is uploaded and checked
 * as a cut-out like any other.
 */
import { isPrivateAddress, safeTarget } from '@/server/modules/embed/check';
import { dohResolver, type Resolver } from '@/server/modules/embed/service';
import { CUTOUT_MAX_BYTES } from './cutout';

export const STORE_PICTURE_TIMEOUT_MS = 15_000;

/** Why a store picture could not be used, said to the merchant as it is. */
export class StorePictureError extends Error {}

/** PNG or WebP by the bytes themselves (a CDN's content-type is not always right), or null. */
export function pictureFormat(bytes: Uint8Array): 'png' | 'webp' | 'jpeg' | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png';
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'webp';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  return null;
}

async function readCapped(response: Response): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > CUTOUT_MAX_BYTES) throw new StorePictureError('the picture is larger than 10 MB');
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > CUTOUT_MAX_BYTES) { await reader.cancel().catch(() => undefined); throw new StorePictureError('the picture is larger than 10 MB'); }
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks as BlobPart[]).arrayBuffer());
}

/** Fetch one store picture under the rules above: its bytes and format. */
export async function fetchStorePicture(link: string, fetchImpl: typeof fetch = fetch, resolve: Resolver = dohResolver(fetchImpl)): Promise<{ bytes: Uint8Array; format: 'png' | 'webp' }> {
  const picture = await fetchStorePhoto(link, fetchImpl, resolve);
  if (picture.format === 'jpeg') throw new StorePictureError('this picture is a JPEG, which has no transparent background — the try-on needs the product cut out (a PNG or WebP with a clear background)');
  return { bytes: picture.bytes, format: picture.format };
}

/** T88 — the same fetch, any of PNG, WebP or JPEG. */
export async function fetchStorePhoto(link: string, fetchImpl: typeof fetch = fetch, resolve: Resolver = dohResolver(fetchImpl)): Promise<{ bytes: Uint8Array; format: 'png' | 'webp' | 'jpeg' }> {
  let target = safeTarget(link, null);
  if (!target.ok) throw new StorePictureError(`the picture's address ${target.reason}`);
  for (let hop = 0; hop <= 3; hop++) {
    const addresses = await resolve(target.url.hostname);
    if (!addresses) throw new StorePictureError('we could not look up the picture’s address');
    if (!addresses.length) throw new StorePictureError('the picture’s address does not exist');
    if (addresses.some(isPrivateAddress)) throw new StorePictureError('the picture’s address points to a private network, which we will not open');
    let response: Response;
    try {
      response = await fetchImpl(target.url.href, { redirect: 'manual', signal: AbortSignal.timeout(STORE_PICTURE_TIMEOUT_MS), headers: { 'user-agent': 'TajribahPictureReader/1.0', accept: 'image/png, image/webp, image/*' } });
    } catch {
      throw new StorePictureError('the store’s picture did not answer');
    }
    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      target = safeTarget(new URL(location, target.url).href, null);
      if (!target.ok) throw new StorePictureError(`the picture redirected somewhere we will not follow: ${target.reason}`);
      continue;
    }
    if (!response.ok) throw new StorePictureError(`the store answered ${response.status} for this picture`);
    const bytes = await readCapped(response);
    const format = pictureFormat(bytes);
    if (!format) throw new StorePictureError('this is not a PNG, WebP or JPEG picture');
    return { bytes, format };
  }
  throw new StorePictureError('the picture redirected too many times');
}
