# Salla Embedded App SDK 0.2.6 (vendored)

`index.js` and `index.d.ts` are `@salla.sa/embedded-sdk@0.2.6` — `dist/esm/index.js` and
`dist/types/index.d.ts`, copied unchanged from the npm tarball (sha512 integrity checked against the
registry, 2026-09-30). Apache-2.0 (`LICENSE`, Salla).

Why vendored: the app's `node_modules` is shared with another working copy and has no lockfile, so
adding a package would re-resolve every dependency. The ESM build (not the UMD one) is used because it
reads `process.env.NODE_ENV`, which the bundler replaces — in production it then accepts messages only
from Salla's own origins (`s.salla.sa`, `*.salla.sa`, `*.salla.group`). The UMD build leaves that
expression for the browser, where it throws.

Used by the Salla app page (`components/pages/SallaApp.tsx`, T61). To update: take the same two files
from a newer tarball, check the integrity hash, and change the folder name.
