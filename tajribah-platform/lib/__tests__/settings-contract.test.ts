import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SettingsPatch } from '@/lib/contracts/settings';

const ok = (input: unknown) => { const r = SettingsPatch.safeParse(input); assert.ok(r.success, JSON.stringify(r)); return (r as { data: Record<string, unknown> }).data; };
const refused = (input: unknown, field: string) => {
  const r = SettingsPatch.safeParse(input);
  assert.ok(!r.success && r.error.issues.some((i) => i.path[0] === field), `${field} should be refused: ${JSON.stringify(input)}`);
};

test('CR: 10 digits; Arabic-Indic digits, spaces and dashes are folded; blank clears', () => {
  assert.equal(ok({ crNumber: '1010123456' }).crNumber, '1010123456');
  assert.equal(ok({ crNumber: '١٠١٠١٢٣٤٥٦' }).crNumber, '1010123456');
  assert.equal(ok({ crNumber: '1010-123 456' }).crNumber, '1010123456');
  assert.equal(ok({ crNumber: '  ' }).crNumber, null);
  refused({ crNumber: '101012345' }, 'crNumber');
  refused({ crNumber: '10101234567' }, 'crNumber');
  refused({ crNumber: 'CR1010123456' }, 'crNumber');
});

test('VAT: 15 digits, first and last 3 (ZATCA)', () => {
  assert.equal(ok({ vatNumber: '300000000000003' }).vatNumber, '300000000000003');
  assert.equal(ok({ vatNumber: '٣٠٠٠٠٠٠٠٠٠٠٠٠٠٣' }).vatNumber, '300000000000003');
  refused({ vatNumber: '200000000000003' }, 'vatNumber');
  refused({ vatNumber: '300000000000002' }, 'vatNumber');
  refused({ vatNumber: '30000000000003' }, 'vatNumber');
});

test('brand colour, button radius, names and unknown fields', () => {
  assert.equal(ok({ brandColor: '#0B7A75' }).brandColor, '#0B7A75');
  refused({ brandColor: 'teal' }, 'brandColor');
  refused({ buttonRadius: 40 }, 'buttonRadius');
  refused({ name: '   ' }, 'name');
  assert.equal(SettingsPatch.safeParse({ slug: 'new-slug' }).success, false, 'the slug is not editable here');
});
