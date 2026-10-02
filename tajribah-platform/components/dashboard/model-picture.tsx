'use client';

/**
 * P3.8 — a 3D model's picture, fetched with the session (an `<img>` cannot send it) and shown from a
 * `blob:` URL; the box icon until there is one, or when it cannot be read. `stamp` changes when the
 * picture does, so a new one is fetched.
 */
import { useEffect, useState } from 'react';
import { Box } from 'lucide-react';
import { useData } from '@/lib/data';
import { PICTURE_MAX_ASPECT, PICTURE_MAX_SIDE } from '@/lib/model-picture';

export function ModelPicture({ modelId, stamp, alt, size }: { modelId: string; stamp: string | null; alt: string; size: number }) {
  const source = useData();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!stamp) return;
    let live = true;
    let made: string | null = null;
    source.modelPicture(modelId)
      .then((blob) => { if (live) { made = URL.createObjectURL(blob); setUrl(made); } })
      .catch(() => { if (live) setUrl(null); });
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [source, modelId, stamp]);
  return url && stamp
    ? <img src={url} alt={alt} width={size} height={size} style={{ width: size, height: size, objectFit: 'contain', borderRadius: 9, background: 'var(--tint)', display: 'block' }} />
    : <Box size={Math.round(size * 0.45)} aria-hidden />;
}

/**
 * The viewer's current view as the picture: what `<model-viewer>` draws, fitted inside the limits the
 * server checks (`lib/model-picture.ts`) — at most 1200 px a side here, never longer than twice its
 * height — and encoded as WebP (PNG where the browser cannot write WebP).
 */
export async function captureView(viewer: HTMLElement & { toBlob?: (o?: { mimeType?: string; qualityArgument?: number; idealAspect?: boolean }) => Promise<Blob> }): Promise<Blob> {
  if (!viewer.toBlob) throw new Error('the 3D view cannot be captured in this browser');
  const shot = await viewer.toBlob({ mimeType: 'image/png', idealAspect: false });
  const image = await createImageBitmap(shot);
  // Crop the longer side to at most twice the shorter, keeping the middle, then scale to fit.
  let sw = image.width, sh = image.height;
  if (sw > sh * PICTURE_MAX_ASPECT) sw = Math.floor(sh * PICTURE_MAX_ASPECT);
  if (sh > sw * PICTURE_MAX_ASPECT) sh = Math.floor(sw * PICTURE_MAX_ASPECT);
  const scale = Math.min(1, Math.min(1200, PICTURE_MAX_SIDE) / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d')!.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, 0, 0, canvas.width, canvas.height);
  image.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('the picture could not be made'))), 'image/webp', 0.88));
}
