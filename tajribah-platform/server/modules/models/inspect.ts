/**
 * P1.12 — is this upload the 3D file it claims to be? Read from the first bytes only, so a
 * 50 MB model is never loaded to check it.
 *
 *  - **GLB** (glTF 2.0 binary, Khronos spec §4.4): magic `glTF`, version 2, a declared total
 *    length that must equal the stored size — a truncated upload has the right magic and the
 *    wrong length — and a first chunk of type `JSON`.
 *  - **USDZ** (Pixar USDZ spec): an uncompressed zip whose first entry is the USD layer
 *    (`.usd`, `.usda` or `.usdc`). Quick Look refuses anything else.
 *
 * An extension or a content type is a claim; these bytes are the fact.
 */
export const UPLOAD_FORMATS = ['glb', 'usdz'] as const;
export type UploadFormat = (typeof UPLOAD_FORMATS)[number];

export const CONTENT_TYPES: Record<UploadFormat, string> = {
  glb: 'model/gltf-binary',
  usdz: 'model/vnd.usdz+zip',
};

/** Before optimisation (P1.13). The widget's own budget is enforced on the optimised file. */
export const MAX_MODEL_BYTES = 50 * 1024 * 1024;

/** How many leading bytes `inspect` needs: the GLB header + first chunk header, or a zip local header + a name. */
export const HEADER_BYTES = 30 + 256;

const GLB_MAGIC = 0x46546c67; // 'glTF', little-endian
const CHUNK_JSON = 0x4e4f534a; // 'JSON'
const ZIP_LOCAL = 0x04034b50; // 'PK\x03\x04'

export function formatOf(filename: string): UploadFormat | null {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  return (UPLOAD_FORMATS as readonly string[]).includes(ext) ? (ext as UploadFormat) : null;
}

/** Null when the bytes are a valid `format` file of `size` bytes; otherwise why not. */
export function inspect(format: UploadFormat, head: Uint8Array, size: number): string | null {
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (format === 'glb') {
    if (head.byteLength < 20) return 'too short to be a GLB file';
    if (view.getUint32(0, true) !== GLB_MAGIC) return 'not a GLB file (the first bytes are not "glTF")';
    const version = view.getUint32(4, true);
    if (version !== 2) return `glTF version ${version} is not supported — export as glTF 2.0`;
    const declared = view.getUint32(8, true);
    if (declared !== size) return `the file is ${size} bytes but says it is ${declared} — the upload was cut off or the file is damaged`;
    if (view.getUint32(16, true) !== CHUNK_JSON) return 'the GLB file does not start with its JSON chunk';
    return null;
  }
  if (head.byteLength < 30) return 'too short to be a USDZ file';
  if (view.getUint32(0, true) !== ZIP_LOCAL) return 'not a USDZ file (it is not a zip archive)';
  const method = view.getUint16(8, true);
  if (method !== 0) return 'USDZ files must be stored uncompressed — re-export it with a USDZ tool';
  const nameLength = view.getUint16(26, true);
  if (head.byteLength < 30 + nameLength) return 'the USDZ archive header is incomplete';
  const firstEntry = new TextDecoder().decode(head.subarray(30, 30 + nameLength));
  if (!/\.usd[ac]?$/i.test(firstEntry)) return `the first file in the USDZ archive must be the USD scene, not "${firstEntry}"`;
  return null;
}
