'use client';

/**
 * `<model-viewer>` for our own screens (the staff review, P3.6; the merchant's editor, P3.8), from
 * the vendored copy in `public/vendor/`, loaded once on first use and told where the meshopt
 * decoder is before it runs (it reads `self.ModelViewerElement` once). The storefront widget has
 * its own loader (`widget/src/main.ts`); both use the same files.
 */
export const VIEWER_SRC = '/vendor/model-viewer-4.0.0.min.js';
export const MESHOPT_DECODER_SRC = '/vendor/meshopt_decoder-1.2.0.js';

let ready: Promise<void> | null = null;

export function loadModelViewer(): Promise<void> {
  ready ??= new Promise<void>((resolve, reject) => {
    if (customElements.get('model-viewer')) { resolve(); return; }
    const scope = window as unknown as { ModelViewerElement?: { meshoptDecoderLocation?: string } };
    scope.ModelViewerElement ??= {};
    scope.ModelViewerElement.meshoptDecoderLocation ??= new URL(MESHOPT_DECODER_SRC, location.href).href;
    const script = document.createElement('script');
    script.type = 'module';
    script.src = VIEWER_SRC;
    script.onload = () => customElements.whenDefined('model-viewer').then(() => resolve());
    script.onerror = () => { ready = null; reject(new Error('the 3D viewer did not load')); };
    document.head.appendChild(script);
  });
  return ready;
}
