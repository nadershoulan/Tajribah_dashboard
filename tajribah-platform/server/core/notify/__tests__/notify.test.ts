import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConsoleEmailSender, ConsoleSmsSender, ResendEmailSender, UnifonicSmsSender,
  assertSmsLength, configureNotify, emailSender, smsParts, smsSender,
} from '@/server/core/notify/notify';
import { EMAIL, SMS, sendEmail, sendSms, smsTemplate } from '@/server/core/notify/messages';
import { setLogLevel } from '@/server/core/observability/log';

/** Run `fn` with console.log captured; returns everything it printed. */
async function captured(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

/** Run `fn` with fetch replaced; returns the requests it made. */
async function withFetch(status: number, fn: () => Promise<void>): Promise<{ url: string; init: RequestInit }[]> {
  const calls: { url: string; init: RequestInit }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status });
  }) as typeof fetch;
  try { await fn(); } finally { globalThis.fetch = original; }
  return calls;
}

const ARABIC_70 = 'ا'.repeat(70);

test('Arabic is UCS-2: 70 characters is one part, 71 is two', () => {
  assert.deepEqual(smsParts(ARABIC_70), { encoding: 'ucs2', units: 70, perPart: 70, parts: 1 });
  assert.equal(smsParts(ARABIC_70 + 'ا').parts, 2);
  // One Arabic letter drags a whole English message down to 70 per part.
  assert.equal(smsParts('a'.repeat(100) + 'ب').parts, 2);
});

test('plain English is GSM: 160 is one part, 161 is two', () => {
  assert.equal(smsParts('a'.repeat(160)).encoding, 'gsm');
  assert.equal(smsParts('a'.repeat(160)).parts, 1);
  assert.equal(smsParts('a'.repeat(161)).parts, 2);
});

test('GSM extension characters cost two septets; a backtick is not GSM at all', () => {
  assert.deepEqual(smsParts('{'.repeat(80)), { encoding: 'gsm', units: 160, perPart: 160, parts: 1 });
  assert.equal(smsParts('{'.repeat(81)).parts, 2);
  assert.equal(smsParts('€').units, 2);
  assert.equal(smsParts('`').encoding, 'ucs2');
  assert.equal(smsParts('“quoted”').encoding, 'ucs2', 'curly quotes force UCS-2');
  assert.equal(smsParts('line\nbreak £5 é').encoding, 'gsm');
});

test('the 70-character assertion fails a too-long Arabic template', () => {
  assert.throws(() => assertSmsLength(ARABIC_70 + 'ا'), /limit is 70, not 160/);
  assert.doesNotThrow(() => assertSmsLength(ARABIC_70));
  // …at definition time, so it breaks boot rather than a send.
  assert.throws(
    () => smsTemplate('too-long', { code: '000000' }, ({ code }) => ({
      ar: `رمز التحقق الخاص بك في منصة تجربة للتجربة الافتراضية هو ${code}، وهو صالح لمدة عشر دقائق فقط`,
      en: `Code ${code}`,
    })),
    /SMS template "too-long" \(ar\) is too long/,
  );
});

test('every defined SMS template fits one part in both languages', () => {
  for (const template of Object.values(SMS)) {
    for (const lang of ['ar', 'en'] as const) {
      const text = template.render(template.sample as never, lang);
      assert.equal(smsParts(text).parts, 1, `${template.name} (${lang}): "${text}"`);
    }
  }
  assert.equal(smsParts(SMS.otp.render({ code: '000000', minutes: 10 }, 'ar')).encoding, 'ucs2');
});

test('in development, sending prints the message', async () => {
  setLogLevel('error');
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });

  const sms = await captured(() => sendSms('+966501234567', SMS.otp, { code: '482913', minutes: 10 }, 'ar'));
  assert.match(sms, /sms to \+966501234567 \(ucs2, 1 part\)/);
  assert.match(sms, /482913/);
  assert.match(sms, /رمز التحقق/);

  const mail = await captured(() => sendEmail('owner@example.test', EMAIL.verifyEmail, { link: 'http://localhost:5173/verify?t=abc' }, 'en'));
  assert.match(mail, /email to owner@example\.test/);
  assert.match(mail, /Confirm your email/);
  assert.match(mail, /verify\?t=abc/, 'the developer needs the link');
  setLogLevel('info');
});

test('email templates render both languages with the link', () => {
  const link = 'https://app.example/reset?t=1';
  const ar = EMAIL.passwordReset({ link, minutes: 60 }, 'ar');
  const en = EMAIL.passwordReset({ link, minutes: 60 }, 'en');
  assert.match(ar.subject, /كلمة المرور/);
  assert.ok(ar.text.includes(link) && en.text.includes(link));
  assert.match(en.text, /60 minutes/);
});

test('T119: every email has a branded HTML part — right to left in Arabic, the link as a button, nothing injected', () => {
  const link = 'https://app.example/verify?t=1&x=2';
  const ar = EMAIL.verifyEmail({ link }, 'ar');
  const en = EMAIL.verifyEmail({ link }, 'en');
  assert.match(ar.html, /<html lang="ar" dir="rtl">/);
  assert.match(ar.html, /text-align:right/);
  assert.doesNotMatch(ar.html, /text-align:left/, 'no block of an Arabic mail is left-aligned');
  assert.match(en.html, /<html lang="en" dir="ltr">/);
  assert.match(ar.html, />تأكيد البريد الإلكتروني<\/a>/, 'the button carries its label');
  assert.match(en.html, />Confirm my email<\/a>/);
  assert.ok(ar.html.includes('href="https://app.example/verify?t=1&amp;x=2"'), 'the link is the button, escaped');
  assert.ok(ar.html.includes('tajribah-wordmark.png'), 'the logo heads the mail');
  assert.ok(ar.text.includes(link) && !ar.text.includes('<'), 'the text part stays plain, with the raw link');
  // a store name is the merchant's own text: it is escaped, never markup
  const invite = EMAIL.teamInvite({ link, store: '<img src=x onerror=alert(1)>', days: 7 }, 'en');
  assert.doesNotMatch(invite.html, /<img src=x/);
  assert.match(invite.html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  // a template with no link has no button
  assert.doesNotMatch(EMAIL.twoFactorResetByStaff({}, 'ar').html, /background:#00a7bc/);
  // and every template renders
  for (const [name, t] of Object.entries(EMAIL)) {
    const sample = { link, minutes: 60, store: 's', days: 7, number: '1', total: '1', amount: '1', retryAt: null, title: { ar: 'a', en: 'a' }, body: { ar: 'b', en: 'b' }, period: { ar: 'p', en: 'p' }, lines: { ar: 'l', en: 'l' }, on: true };
    for (const lang of ['ar', 'en'] as const) assert.match((t as (p: unknown, l: string) => { html: string })(sample, lang).html, /^<!doctype html>/, name);
  }
});

test('a number that is not E.164 is refused before anything is sent', async () => {
  const console_ = new ConsoleSmsSender();
  await assert.rejects(() => console_.send({ to: '0501234567', text: 'x' }), /E\.164/);
  const calls = await withFetch(200, async () => {
    await assert.rejects(() => new UnifonicSmsSender('sid', 'Tajribah').send({ to: '٠٥٠١٢٣٤٥٦٧', text: 'x' }), /E\.164/);
  });
  assert.equal(calls.length, 0);
});

test('configureNotify installs the provider the environment names', () => {
  configureNotify({
    EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test', EMAIL_FROM: 'Tajribah <a@b.test>',
    SMS_PROVIDER: 'unifonic', UNIFONIC_APP_SID: 'sid', UNIFONIC_SENDER_ID: 'Tajribah',
  });
  assert.ok(emailSender() instanceof ResendEmailSender);
  assert.ok(smsSender() instanceof UnifonicSmsSender);
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  assert.ok(emailSender() instanceof ConsoleEmailSender);
  assert.ok(smsSender() instanceof ConsoleSmsSender);
});

test('Unifonic gets the sender, the number without +, and the body; a refusal throws', async () => {
  const sender = new UnifonicSmsSender('app-sid', 'Tajribah');
  const calls = await withFetch(200, () => sender.send({ to: '+966501234567', text: 'مرحبا' }));
  assert.equal(calls.length, 1);
  const body = new URLSearchParams(String(calls[0].init.body));
  assert.equal(body.get('Recipient'), '966501234567');
  assert.equal(body.get('SenderID'), 'Tajribah');
  assert.equal(body.get('Body'), 'مرحبا');

  await withFetch(401, async () => {
    await assert.rejects(() => sender.send({ to: '+966501234567', text: 'x' }), /Unifonic rejected the message: 401/);
  });
});

test('Resend gets a text body and the configured sender', async () => {
  const sender = new ResendEmailSender('re_test', 'Tajribah <no-reply@example.test>');
  const calls = await withFetch(200, () => sender.send({ to: 'a@b.test', subject: 's', text: 'body' }));
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.from, 'Tajribah <no-reply@example.test>');
  assert.equal(body.text, 'body');
  assert.equal((calls[0].init.headers as Record<string, string>).authorization, 'Bearer re_test');
});

test('T110: with SMS switched off, a send fails loudly — nothing pretends a code went out', async () => {
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'none' });
  const printed = await captured(async () => {
    await assert.rejects(() => sendSms('+966501234567', SMS.otp, { code: '482913', minutes: 10 }, 'ar'), /SMS is off in this version/);
  });
  assert.doesNotMatch(printed, /482913/, 'the code is not printed either');
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
});
