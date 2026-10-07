/**
 * T112 — email through an SMTP mailbox (Zoho Mail: smtppro.zoho.com:465, the account's app password), sent from
 * the alias `no-reply@tajribah.org`. Implicit TLS only (465): the connection is encrypted before a word is said.
 *
 * The socket comes from the runtime: `cloudflare:sockets` on the Worker (`server/boot.ts`), `node:tls` in the Node
 * worker and scripts (`smtp-node.ts`). This file imports neither, so it runs in tests with a scripted server.
 * Arabic is safe end to end: headers as RFC 2047 UTF-8 words, bodies as base64 UTF-8. The password never appears in
 * an error: a refusal reports the step and the server's code only.
 */
import type { EmailMessage, EmailSender } from './notify';

export type SmtpSocket = {
  write(data: string): Promise<void>;
  /** The next chunk the server sent, or null when it closed the connection. */
  read(): Promise<string | null>;
  close(): Promise<void>;
};
/** Opens an implicit-TLS connection to host:port. */
export type SmtpConnector = (host: string, port: number) => Promise<SmtpSocket>;

export type SmtpConfig = { host: string; port: number; user: string; password: string; from: string };

const CRLF = '\r\n';
const b64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
const wrap76 = (s: string) => s.replace(/.{1,76}/g, (line) => line + CRLF);

/** A header value: ASCII as is, anything else as a UTF-8 encoded word. */
export function headerWord(text: string): string {
  return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${b64(text)}?=`;
}

/** "Tajribah <no-reply@tajribah.org>" → its address and a header-safe form. */
export function parseFrom(from: string): { address: string; header: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  if (!m) return { address: from.trim(), header: from.trim() };
  return { address: m[2]!, header: m[1] ? `${headerWord(m[1].replace(/^"|"$/g, ''))} <${m[2]}>` : `<${m[2]}>` };
}

/** The whole message, CRLF line endings, ready for DATA (before dot-stuffing). */
export function buildMime(from: string, message: EmailMessage, now = new Date(), id = crypto.randomUUID()): string {
  const sender = parseFrom(from);
  const domain = sender.address.split('@')[1] ?? 'localhost';
  const headers = [
    `From: ${sender.header}`,
    `To: <${message.to}>`,
    `Subject: ${headerWord(message.subject)}`,
    `Date: ${now.toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${id}@${domain}>`,
    'MIME-Version: 1.0',
    ...(message.replyTo ? [`Reply-To: <${message.replyTo}>`] : []),
    ...(message.lang ? [`Content-Language: ${message.lang}`] : []),
  ];
  const part = (type: string, body: string) => [`Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(b64(body))].join(CRLF);
  if (!message.html) return [...headers, part('text/plain', message.text)].join(CRLF);
  const boundary = `tajribah-${id}`;
  return [
    ...headers,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`, part('text/plain', message.text),
    `--${boundary}`, part('text/html', message.html),
    `--${boundary}--`, '',
  ].join(CRLF);
}

/** Lines that start with "." get another, and the message ends with CRLF "." CRLF (RFC 5321 §4.5.2). */
export function dotStuff(mime: string): string {
  const body = mime.replace(/\r?\n/g, CRLF).replace(/^\./gm, '..');
  return `${body.endsWith(CRLF) ? body : body + CRLF}.${CRLF}`;
}

/** Reads whole replies (multi-line "250-…" … "250 …") from the socket. */
class Replies {
  private buffer = '';
  constructor(private readonly socket: SmtpSocket) {}
  async next(): Promise<{ code: number; text: string }> {
    for (;;) {
      const lines = this.buffer.split(CRLF);
      for (let i = 0; i < lines.length - 1; i++) {
        if (/^\d{3} /.test(lines[i]!) || /^\d{3}$/.test(lines[i]!)) {
          const reply = lines.slice(0, i + 1);
          this.buffer = lines.slice(i + 1).join(CRLF);
          return { code: Number(lines[i]!.slice(0, 3)), text: reply.map((l) => l.slice(4)).join(' ') };
        }
      }
      const chunk = await this.socket.read();
      if (chunk === null) throw new Error('SMTP: the server closed the connection');
      this.buffer += chunk;
    }
  }
}

export class SmtpEmailSender implements EmailSender {
  constructor(private readonly config: SmtpConfig, private readonly connect: () => SmtpConnector) {}

  async send(message: EmailMessage): Promise<void> {
    const { host, port, user, password, from } = this.config;
    const socket = await this.connect()(host, port);
    const replies = new Replies(socket);
    const expect = async (step: string, ok: number[]) => {
      const reply = await replies.next();
      // The server's words, never ours: what we sent may hold the password.
      if (!ok.includes(reply.code)) throw new Error(`SMTP ${step} refused: ${reply.code} ${reply.text.slice(0, 120)}`);
      return reply;
    };
    const say = (line: string) => socket.write(line + CRLF);
    try {
      await expect('greeting', [220]);
      await say(`EHLO ${parseFrom(from).address.split('@')[1] ?? 'localhost'}`);
      await expect('EHLO', [250]);
      await say(`AUTH PLAIN ${b64(`\0${user}\0${password}`)}`);
      await expect('sign-in', [235]);
      await say(`MAIL FROM:<${parseFrom(from).address}>`);
      await expect('sender', [250]);
      await say(`RCPT TO:<${message.to}>`);
      await expect('recipient', [250, 251]);
      await say('DATA');
      await expect('DATA', [354]);
      await socket.write(dotStuff(buildMime(from, message)));
      await expect('message', [250]);
      await say('QUIT');
    } finally {
      await socket.close().catch(() => undefined);
    }
  }
}

/** The Worker's socket: `connect` from `cloudflare:sockets`, TLS from the first byte. */
export function cloudflareConnector(connect: (address: { hostname: string; port: number }, options: { secureTransport: 'on'; allowHalfOpen: boolean }) => {
  readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>; close(): Promise<void>;
}): SmtpConnector {
  return async (hostname, port) => {
    const socket = connect({ hostname, port }, { secureTransport: 'on', allowHalfOpen: false });
    const reader = socket.readable.getReader();
    const writer = socket.writable.getWriter();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    return {
      write: (data) => writer.write(encoder.encode(data)),
      read: async () => { const { value, done } = await reader.read(); return done ? null : decoder.decode(value, { stream: true }); },
      close: async () => { try { writer.releaseLock(); reader.releaseLock(); } finally { await socket.close(); } },
    };
  };
}
