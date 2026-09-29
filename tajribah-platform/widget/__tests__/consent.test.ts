/**
 * T48 — a shop that asks for consent: the snippet says so, the banner's answer is honoured even
 * when it comes before the async script, and nothing else counts as consent.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTR, CONSENT_LINE, initialConsent } from '../src/main';
import { embedSnippet } from '../src/snippet';
import { inspectHtml } from '@/server/modules/embed/check';

test('the consent snippet carries the gate; the plain one does not; both install', () => {
  const plain = embedSnippet('failet', '1');
  const gated = embedSnippet('failet', '1', { consent: true });
  assert.ok(!plain.includes(ATTR.consent));
  assert.ok(gated.includes(`${ATTR.consent}="required"`));
  assert.equal(gated.replace(` ${ATTR.consent}="required"`, ''), plain, 'the only difference is the gate');
  assert.equal(inspectHtml(gated, 'failet').status, 'installed', 'the checker accepts it');
});

test('an answer given before the script loaded is honoured — and only an exact "granted"', () => {
  assert.equal(initialConsent('required', 'granted'), 'granted');
  for (const odd of [undefined, null, true, 'yes', 'GRANTED', 1]) assert.equal(initialConsent('required', odd), 'required', String(odd));
  assert.equal(initialConsent('granted', undefined), 'granted', 'a shop without a banner measures as before');
});

test('the banner’s line works before and after the script: it sets the answer and calls the API when present', () => {
  const run = (win: Record<string, unknown>) => new Function('window', CONSENT_LINE)(win);
  const early: Record<string, unknown> = {};
  run(early);
  assert.equal(early.tajribahConsent, 'granted', 'before: the answer waits for the script');
  const calls: string[] = [];
  const late: Record<string, unknown> = { Tajribah: { consent: (s: string) => calls.push(s) } };
  run(late);
  assert.deepEqual(calls, ['granted'], 'after: the loaded script is told directly');
});
