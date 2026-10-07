/**
 * P3.5 — `<model-viewer>` only decodes our meshopt-compressed models when told where the decoder
 * is. Seen in a real browser before this existed: "setMeshoptDecoder must be called before
 * loading compressed files" — no model would have loaded in the in-page viewer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MESHOPT_DECODER_FILE, configureMeshopt } from '../src/main';

const VIEWER = 'https://cdn.tajribah.org/vendor/model-viewer-4.0.0.min.js';
const DECODER = `https://cdn.tajribah.org/vendor/${MESHOPT_DECODER_FILE}`;

test('before the viewer loads: the decoder next to the viewer, set where the viewer reads it once', () => {
  const scope: { ModelViewerElement?: { meshoptDecoderLocation?: string } } = {};
  assert.equal(configureMeshopt(VIEWER, scope), DECODER);
  assert.deepEqual(scope.ModelViewerElement, { meshoptDecoderLocation: DECODER });
  // A shop that set its own is left alone.
  const own = { ModelViewerElement: { meshoptDecoderLocation: 'https://shop.example/meshopt.js' } };
  assert.equal(configureMeshopt(VIEWER, own), 'https://shop.example/meshopt.js');
});

test('a viewer the shop already loaded is told on its class, unless it already knows', () => {
  const unset: { meshoptDecoderLocation?: string } = {};
  assert.equal(configureMeshopt(VIEWER, { customElements: { get: () => unset } }), DECODER);
  assert.equal(unset.meshoptDecoderLocation, DECODER);
  const set = { meshoptDecoderLocation: 'https://shop.example/meshopt.js' };
  assert.equal(configureMeshopt(VIEWER, { customElements: { get: () => set } }), 'https://shop.example/meshopt.js');
});

test('the decoder file is the version the optimiser encodes with', () => {
  const version = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/meshoptimizer/package.json'), 'utf8')).version;
  assert.equal(MESHOPT_DECODER_FILE, `meshopt_decoder-${version}.js`);
});
