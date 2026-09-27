/**
 * P3.3 — what can be known about a product photo from its bytes alone, before any credits are
 * spent on it: what it really is, how big, and whether it is the same photo twice.
 *
 * Pure, and header-only for dimensions: JPEG (baseline and progressive), PNG and WebP (lossy,
 * lossless and extended) are read from their own headers, never from what the browser claimed.
 * What needs the pixels — blur, exposure, a busy background — is not judged here: decoding a
 * 20 MB photo in the Worker is the wrong place, and a guess dressed as a score would mislead.
 * Those checks belong to the AI service (P3.1). The score this module gives is therefore about
 * the file, and says so.
 */
export type PhotoFormat = 'jpeg' | 'png' | 'webp';

/** Formats every generation provider we might use accepts. HEIC is refused with a clear reason. */
export const PHOTO_CONTENT_TYPES: Record<PhotoFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Below this on the short side, a model generated from it has too little detail to be worth the credits. */
export const MIN_SHORT_SIDE = 768;
/** At or above this on the short side, nothing about the size costs quality. */
export const GOOD_SHORT_SIDE = 1500;
/** Larger than any phone photo; anything bigger is not a photo. */
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
/** Long side over short side. A panorama or a strip is not a product photo. */
export const MAX_ASPECT = 3;

export type PhotoIssue =
  | 'unsupported_format' | 'unreadable' | 'too_small' | 'too_large_file' | 'extreme_aspect' | 'duplicate' // refuse
  | 'low_resolution'; // accept, with a lower score

export const BLOCKING: readonly PhotoIssue[] = ['unsupported_format', 'unreadable', 'too_small', 'too_large_file', 'extreme_aspect', 'duplicate'];

export type PhotoFacts = { format: PhotoFormat; width: number; height: number };

export type PhotoVerdict = {
  accepted: boolean;
  facts: PhotoFacts | null;
  issues: PhotoIssue[];
  /** 0–100, about the file only (size and shape). Null when refused. */
  score: number | null;
};

/** What the first bytes say the file is. */
export function sniff(bytes: Uint8Array): PhotoFormat | 'heic' | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return 'png';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  // ISO-BMFF `ftyp` box with an HEIF brand: what iPhones save by default.
  if (bytes.length >= 12 && ascii(bytes, 4, 4) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1|avif)$/.test(ascii(bytes, 8, 4))) return 'heic';
  return null;
}

/** Width and height from the file's own header; null if the header is not where it should be. */
export function dimensions(bytes: Uint8Array, format: PhotoFormat): { width: number; height: number } | null {
  if (format === 'png') {
    if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return null;
    return positive(u32be(bytes, 16), u32be(bytes, 20));
  }
  if (format === 'webp') return webpDimensions(bytes);
  return jpegDimensions(bytes);
}

/**
 * JPEG: walk the markers to the first start-of-frame. SOF0–SOF15 except DHT (C4), JPG (C8) and
 * DAC (CC); progressive photos use SOF2, which is why looking only for C0 is a classic bug.
 */
function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1]!;
    if (marker === 0xff) { i += 1; continue; } // fill byte
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; } // no length
    const length = (bytes[i + 2]! << 8) | bytes[i + 3]!;
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) return positive((bytes[i + 7]! << 8) | bytes[i + 8]!, (bytes[i + 5]! << 8) | bytes[i + 6]!);
    if (marker === 0xda) return null; // image data began before any frame header
    i += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ' && bytes.length >= 30) {
    // Lossy: a key frame starts 9D 01 2A, then 14-bit width and height.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return positive(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  }
  if (chunk === 'VP8L' && bytes.length >= 25) {
    // Lossless: signature 0x2F, then width-1 and height-1 as 14-bit fields.
    if (bytes[20] !== 0x2f) return null;
    const b = bytes;
    const width = 1 + (((b[22]! & 0x3f) << 8) | b[21]!);
    const height = 1 + (((b[24]! & 0x0f) << 10) | (b[23]! << 2) | ((b[22]! & 0xc0) >> 6));
    return positive(width, height);
  }
  if (chunk === 'VP8X' && bytes.length >= 30) {
    // Extended: canvas width-1 and height-1 as 24-bit little-endian.
    return positive(1 + u24le(bytes, 24), 1 + u24le(bytes, 27));
  }
  return null;
}

/**
 * The verdict for one photo. `knownHashes` are the SHA-256s of the product's other accepted
 * photos; the same bytes again is refused as a duplicate (it adds nothing to a model).
 */
export function checkPhoto(bytes: Uint8Array, sizeBytes: number, sha256: string, knownHashes: readonly string[] = []): PhotoVerdict {
  const refuse = (issue: PhotoIssue, facts: PhotoFacts | null = null): PhotoVerdict => ({ accepted: false, facts, issues: [issue], score: null });
  if (sizeBytes > MAX_PHOTO_BYTES) return refuse('too_large_file');
  const format = sniff(bytes);
  if (format === null || format === 'heic') return refuse('unsupported_format');
  const size = dimensions(bytes, format);
  if (!size) return refuse('unreadable');
  const facts: PhotoFacts = { format, ...size };

  const short = Math.min(size.width, size.height);
  const long = Math.max(size.width, size.height);
  const issues: PhotoIssue[] = [];
  if (short < MIN_SHORT_SIDE) issues.push('too_small');
  if (long / short > MAX_ASPECT) issues.push('extreme_aspect');
  if (knownHashes.includes(sha256)) issues.push('duplicate');
  if (issues.length) return { accepted: false, facts, issues, score: null };

  // Size is the one quality fact the bytes give honestly: full marks from GOOD_SHORT_SIDE,
  // a straight line down to 60 at the minimum.
  if (short < GOOD_SHORT_SIDE) issues.push('low_resolution');
  const score = short >= GOOD_SHORT_SIDE ? 100
    : Math.round(60 + (40 * (short - MIN_SHORT_SIDE)) / (GOOD_SHORT_SIDE - MIN_SHORT_SIDE));
  return { accepted: true, facts, issues, score };
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8);
const u24le = (b: Uint8Array, at: number) => b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16);
const u32be = (b: Uint8Array, at: number) => ((b[at]! << 24) >>> 0) + (b[at + 1]! << 16) + (b[at + 2]! << 8) + b[at + 3]!;
const positive = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
