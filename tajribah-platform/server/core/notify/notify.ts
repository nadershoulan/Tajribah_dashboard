/**
 * P0.9 — email and SMS behind interfaces.
 *
 * The console adapters are the default, so development needs no accounts. Production
 * refuses to boot with `SMS_PROVIDER=console` (see the env registry): an OTP that silently
 * goes nowhere is worse than one that fails loudly.
 *
 * **Arabic SMS is 70 characters per part, not 160.** Any non-GSM character forces the whole
 * message into UCS-2, and one Arabic letter is enough. `assertSmsLength` fails the build of
 * a template rather than quietly sending — and being charged for — three parts.
 */
import type { Lang } from '@/lib/lang';
import { log } from '../observability/log';
import type { Env } from '../config/env';

export const SMS_PART_GSM = 160;
export const SMS_PART_UCS2 = 70;

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text is required; HTML is optional. A mail with no text part lands in spam. */
  text: string;
  html?: string;
  replyTo?: string;
  lang?: Lang;
};

export type SmsMessage = {
  /** E.164, `+9665XXXXXXXX`. */
  to: string;
  text: string;
  lang?: Lang;
};

export interface EmailSender { send(message: EmailMessage): Promise<void>; }
export interface SmsSender { send(message: SmsMessage): Promise<void>; }

/**
 * GSM 03.38. The basic set costs one septet per character; the extension set costs two
 * (an escape plus the character). Anything in neither forces the whole message to UCS-2.
 * Control characters are written as escapes, so the source never holds a raw byte.
 */
const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅå' +
  'Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ' +
  ' !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§' +
  '¿abcdefghijklmnopqrstuvwxyzäöñüà',
);
const GSM_EXTENSION = new Set('\f^{}\\[~]|€');

/** True when the text needs UCS-2: one character outside GSM 03.38 is enough. */
export function needsUcs2(text: string): boolean {
  for (const ch of text) {
    if (!GSM_BASIC.has(ch) && !GSM_EXTENSION.has(ch)) return true;
  }
  return false;
}

/**
 * How many billable parts `text` is.
 *
 * `units` is septets for GSM (an extension character counts two) and UTF-16 code units for
 * UCS-2 (an emoji counts two). Concatenated messages lose a few units per part to the header.
 */
export function smsParts(text: string): {
  encoding: 'gsm' | 'ucs2'; units: number; perPart: number; parts: number;
} {
  const ucs2 = needsUcs2(text);
  let units = text.length;
  if (!ucs2) {
    units = 0;
    for (const ch of text) units += GSM_EXTENSION.has(ch) ? 2 : 1;
  }
  const perPart = ucs2 ? SMS_PART_UCS2 : SMS_PART_GSM;
  const multiPart = ucs2 ? 67 : 153;
  const parts = units <= perPart ? 1 : Math.ceil(units / multiPart);
  return { encoding: ucs2 ? 'ucs2' : 'gsm', units, perPart, parts };
}

/**
 * Throws when a template would cost more than `maxParts` messages.
 *
 * Call it on every SMS template at definition time, not at send time: the point is to catch
 * a too-long Arabic string while writing it, not while a merchant waits for an OTP.
 */
export function assertSmsLength(text: string, maxParts = 1): void {
  const { encoding, units, perPart, parts } = smsParts(text);
  if (parts > maxParts) {
    throw new Error(
      `SMS is ${units} ${encoding === 'gsm' ? 'septets' : 'characters'} — ${parts} parts at ${perPart} per part (${encoding}). ` +
      `Allowed: ${maxParts}. Arabic forces UCS-2, so the limit is ${SMS_PART_UCS2}, not ${SMS_PART_GSM}.`,
    );
  }
}

/**
 * Throws unless `to` is E.164. Phone input is normalised (and Arabic-Indic digits folded) by
 * `normalisePhone` before it gets here; a local `05…` number reaching a sender is a bug
 * upstream, and the console adapter catches it in development rather than Unifonic in
 * production.
 */
export function assertE164(to: string): void {
  if (!/^\+[1-9]\d{7,14}$/.test(to)) throw new Error(`SMS recipient must be E.164 (+9665XXXXXXXX), got "${to}"`);
}

// ------------------------------------------------------------------ console adapters

export class ConsoleEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    log.info('email (console)', { to: message.to, subject: message.subject, chars: message.text.length });
    // The body goes to stdout so a developer can click the link in a verification email.
    console.log(`\n--- email to ${message.to} ---\n${message.subject}\n\n${message.text}\n---\n`);
  }
}

export class ConsoleSmsSender implements SmsSender {
  async send(message: SmsMessage): Promise<void> {
    assertE164(message.to);
    const { encoding, parts } = smsParts(message.text);
    log.info('sms (console)', { to: message.to, encoding, parts, chars: message.text.length });
    console.log(`\n--- sms to ${message.to} (${encoding}, ${parts} part) ---\n${message.text}\n---\n`);
  }
}

// -------------------------------------------------------------------- real adapters

/** Resend. Added when the account exists (§12.10); the interface does not change. */
export class ResendEmailSender implements EmailSender {
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
        reply_to: message.replyTo,
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend rejected the message: ${response.status}`);
    }
  }
}

/** Unifonic — the KSA default for SMS and WhatsApp (§5). Needs the account from §12.6. */
export class UnifonicSmsSender implements SmsSender {
  constructor(private readonly appSid: string, private readonly senderId: string) {}

  async send(message: SmsMessage): Promise<void> {
    assertE164(message.to);
    assertSmsLength(message.text, 2);
    const response = await fetch('https://el.cloud.unifonic.com/rest/SMS/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        AppSid: this.appSid,
        SenderID: this.senderId,
        Recipient: message.to.replace('+', ''),
        Body: message.text,
      }),
    });
    if (!response.ok) throw new Error(`Unifonic rejected the message: ${response.status}`);
  }
}

let email: EmailSender = new ConsoleEmailSender();
let sms: SmsSender = new ConsoleSmsSender();

/** What `configureNotify` reads — a slice of the env registry, so tests need not build a whole Env. */
export type NotifyConfig = Pick<Env,
  'EMAIL_PROVIDER' | 'RESEND_API_KEY' | 'EMAIL_FROM' | 'SMS_PROVIDER' | 'UNIFONIC_APP_SID' | 'UNIFONIC_SENDER_ID'>;

/**
 * Install the senders the environment asks for. Called once at boot, after `loadEnv()` —
 * which has already refused a provider without its credentials, so the `!` here cannot fire
 * on a validated env.
 */
export function configureNotify(config: NotifyConfig): void {
  email = config.EMAIL_PROVIDER === 'resend'
    ? new ResendEmailSender(config.RESEND_API_KEY!, config.EMAIL_FROM!)
    : new ConsoleEmailSender();
  sms = config.SMS_PROVIDER === 'unifonic'
    ? new UnifonicSmsSender(config.UNIFONIC_APP_SID!, config.UNIFONIC_SENDER_ID!)
    : new ConsoleSmsSender();
}

export function setEmailSender(sender: EmailSender): void { email = sender; }
export function setSmsSender(sender: SmsSender): void { sms = sender; }
export function emailSender(): EmailSender { return email; }
export function smsSender(): SmsSender { return sms; }
