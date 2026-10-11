/**
 * T137 — share a try-on picture through the phone's own sheet, or save it as a file. A phone lets the share sheet open
 * only straight from the tap: anything waited for first (loading a picture, encoding it) and Safari or Chrome refuse
 * it — which is why sharing failed on a phone. So the picture is made at once (`toDataURL`, `dataUrlBlob`) and the
 * share starts inside the tap; whatever cannot share saves the file instead.
 */

/** A data URL as a Blob, at once (no waiting). */
export function dataUrlBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(',');
  const head = dataUrl.slice(5, comma); // after "data:"
  const type = head.split(';')[0] || 'application/octet-stream';
  const body = dataUrl.slice(comma + 1);
  if (!/;base64$/.test(head)) return new Blob([decodeURIComponent(body)], { type });
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

/** Save the picture as a file (a computer, or a phone that cannot share files). */
export function savePicture(file: File): 'saved' {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = file.name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  return 'saved';
}

/** Call straight from the tap: the share sheet opens at once; refused or unsupported, the file is saved instead. */
export function sharePicture(file: File, title?: string): Promise<'shared' | 'saved' | 'cancelled'> {
  const nav = typeof navigator === 'undefined' ? null : navigator;
  if (nav?.canShare?.({ files: [file] }) && nav.share) {
    return nav.share({ files: [file], ...(title ? { title } : {}) }).then(
      () => 'shared' as const,
      (e: unknown) => (e instanceof DOMException && e.name === 'AbortError' ? ('cancelled' as const) : savePicture(file)),
    );
  }
  return Promise.resolve(savePicture(file));
}
