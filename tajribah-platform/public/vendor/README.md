# Vendored viewer files

Served from `/vendor/` here (the staff model review, P3.6) and, once the CDN exists, from
`https://cdn.tajribah.com/vendor/` for the storefront widget (`widget/src/main.ts`).

| File | Source | Licence |
|---|---|---|
| `model-viewer-4.0.0.min.js` | `@google/model-viewer@4.0.0`, `dist/model-viewer.min.js` (npm, via jsDelivr) | BSD-3-Clause (Google LLC); bundles three.js (MIT) — notices kept in the file |
| `meshopt_decoder-1.2.0.js` | `meshoptimizer@1.2.0`, `meshopt_decoder.cjs` (the UMD build: sets `self.MeshoptDecoder`) | MIT (Arseny Kapoulkine) |

The decoder's version must equal the `meshoptimizer` the optimiser encodes with; `widget/build.mjs`
refuses a mismatch and a test checks `MESHOPT_DECODER_FILE`.
