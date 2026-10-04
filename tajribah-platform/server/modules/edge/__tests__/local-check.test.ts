/** T75: a product can be published on this computer, whose storage is plain http — and only there. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkable } from '@/server/modules/edge/build';
import { parseConfig } from '@/widget/src/config';

const config = (base: string) => JSON.stringify({
  v: 1,
  product: { name: 'Watch', nameAr: null, widthMm: 29.3, heightMm: 29.3 },
  model: null,
  button: { labelAr: 'جرّبها', labelEn: 'Try it', color: '#0a2237', radius: 12, variant: 'solid', icon: true },
  placement: 'wrist', scale: 1, autoRotate: true, shadow: 1,
  tryon: { worn: `${base}/t/a/worn.png`, flat: `${base}/t/a/flat.png`, caseMm: 29.3, sku: null, onMe: false },
});

test('this computer’s own storage reads as https for the check; the config keeps its real address', () => {
  const local = config('http://127.0.0.1:8333/tajribah-local');
  const read = checkable(local, 'http://127.0.0.1:8333/tajribah-local/t/a/worn.png');
  assert.ok(read.includes('https://127.0.0.1:8333/'), 'checked as https');
  assert.ok(!read.includes('http://127.0.0.1'), 'every address of that storage');
  assert.ok(local.includes('http://127.0.0.1:8333/'), 'what is published is unchanged');
  assert.equal(parseConfig(JSON.parse(local)), null, 'the widget refuses it as published (shops load only https)');
  assert.notEqual(parseConfig(JSON.parse(read)), null, 'and accepts it as checked');
  assert.equal(checkable(config('http://localhost:9000/b'), 'http://localhost:9000/b/x.png').includes('https://localhost:9000/'), true);
});

test('anything else is checked as it is — another http host stays refused', () => {
  const remote = config('http://cdn.example.com');
  assert.equal(checkable(remote, 'http://cdn.example.com/t/a/worn.png'), remote, 'not this computer');
  const sneaky = config('http://127.0.0.1.evil.com');
  assert.equal(checkable(sneaky, 'http://127.0.0.1.evil.com/x.png'), sneaky, 'a host that only starts like a local one');
  const https = config('https://cdn.tajribah.com');
  assert.equal(checkable(https, 'https://cdn.tajribah.com/t/a/worn.png'), https, 'real storage: nothing changes');
});
