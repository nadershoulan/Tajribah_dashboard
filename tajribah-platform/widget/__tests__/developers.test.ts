/**
 * P8 — the website's developer page (../tajribah-try-on/lib/developers.ts) states the platform's own
 * facts: the same routes and scopes, the same events, the same limit, key prefix, signature header,
 * timeout and retry window — and its signature-checking example, run as published, accepts a real
 * delivery's signature and refuses a changed body or an old one. An integrator who follows the page
 * and nothing else gets it right.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { API_KEY_PREFIX } from '@/lib/api-keys';
import { V1_RATE, V1_ROUTES } from '@/lib/public-api/v1';
import { RETRY_MINUTES, SIGNATURE_HEADER, WEBHOOK_EVENTS } from '@/lib/webhooks';
import { DELIVERY_TIMEOUT_MS, signature } from '@/server/modules/outgoing-webhooks/deliver';
import { COMPANY } from '../../../tajribah-try-on/lib/site';
import { API, ENDPOINTS, EVENTS, VERIFY_EXAMPLE } from '../../../tajribah-try-on/lib/developers';

test('the developer page lists exactly the routes, scopes and events the platform serves', () => {
  assert.deepEqual(
    ENDPOINTS.map((e) => [e.method.toLowerCase(), e.path, e.scope]),
    V1_ROUTES.map(([method, path, scope]) => [method, path, scope]),
  );
  assert.deepEqual(EVENTS.map((e) => e.name), [...WEBHOOK_EVENTS]);
  for (const e of [...ENDPOINTS, ...EVENTS]) assert.ok(e.what.ar && e.what.en, 'said in both languages');
});

test('and the same numbers and names', () => {
  assert.equal(API.base, `${COMPANY.appUrl}/api/v1`);
  assert.equal(API.reference, `${COMPANY.appUrl}/api/v1/openapi.json`);
  assert.equal(API.keyPrefix, API_KEY_PREFIX);
  assert.equal(API.ratePerMinute, V1_RATE.limit * (60 / V1_RATE.windowSeconds));
  assert.equal(API.signatureHeader, SIGNATURE_HEADER);
  assert.equal(API.timeoutSeconds, DELIVERY_TIMEOUT_MS / 1000);
  const minutes = RETRY_MINUTES.reduce((a, b) => a + b, 0);
  assert.equal(API.retryHours, Math.round(minutes / 60), `retries span ${minutes} minutes`);
});

test('the published signature check, run as published, accepts our signature and refuses a forgery', async () => {
  const verify = new Function('require', `${VERIFY_EXAMPLE}\nreturn verify;`)(require) as (secret: string, header: string, body: string) => boolean;
  const secret = 'whsec_example-secret-0123456789';
  const body = JSON.stringify({ id: 'evt_1', type: 'product.updated', data: { id: 'p1', name: 'مجوهرات' } });
  const now = Math.floor(Date.now() / 1000);
  const header = await signature(secret, now, body);
  assert.equal(verify(secret, header, body), true, 'a real delivery passes');
  assert.equal(verify(secret, header, body.replace('p1', 'p2')), false, 'a changed body fails');
  assert.equal(verify('whsec_another', header, body), false, 'another secret fails');
  assert.equal(verify(secret, await signature(secret, now - 3600, body), body), false, 'an hour-old signature fails');
  assert.equal(verify(secret, 't=abc,v1=00', body), false, 'nonsense fails, it does not throw');
});
