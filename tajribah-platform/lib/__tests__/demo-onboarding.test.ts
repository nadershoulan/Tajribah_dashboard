/**
 * P1.2 — the preview's setup guide answers like the API: the same machine decides the steps,
 * the same slug rule refuses an address, and the home checklist agrees with the guide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '@/lib/api-client';
import { demoSource } from '@/lib/data';

const refused = (field: string) => (e: unknown) => e instanceof ApiError && e.status === 422 && !!e.fields?.[field];

test('demo setup guide: address chosen once, then fixed; the home checklist follows the guide', async () => {
  const start = await demoSource.onboarding();
  assert.equal(start.current, 'store', 'the preview store starts unconfirmed so every step can be tried');
  assert.equal((await demoSource.dashboard()).onboarding.steps.find((s) => s.key === 'store')!.done, false);

  await assert.rejects(() => demoSource.confirmStore('Bad Address'), refused('slug'));
  await assert.rejects(() => demoSource.confirmStore('login'), refused('slug'));
  await assert.rejects(() => demoSource.skipStep('catalogue'), refused('step'));

  const confirmed = await demoSource.confirmStore('failet-store');
  assert.equal(confirmed.current, 'plan');
  assert.equal((await demoSource.settings()).slug, 'failet-store');
  assert.equal((await demoSource.currentTenant()).slug, 'failet-store');
  await assert.rejects(() => demoSource.confirmStore('failet-2'), refused('slug'));

  const skipped = await demoSource.skipStep('plan');
  assert.equal(skipped.steps.find((s) => s.key === 'plan')!.skipped, true);
  assert.notEqual(skipped.current, 'plan');

  const home = await demoSource.dashboard();
  assert.equal(home.onboarding.steps.find((s) => s.key === 'store')!.done, true, 'home and guide agree');
  assert.equal(home.tenant.slug, 'failet-store');
});
