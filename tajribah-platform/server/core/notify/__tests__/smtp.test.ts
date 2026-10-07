/**
 * T112 — email through Zoho's SMTP server, against a scripted server: the conversation in order, the app password
 * sent once (AUTH PLAIN) and never in an error, Arabic subjects and bodies intact, the end-of-message dot rule, and
 * every refusal named by its step.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SmtpEmailSender, buildMime, dotStuff, headerWord, parseFrom, type SmtpConnector } from '../smtp';
import { configureNotify, emailSender, setSmtpConnector } from '../notify';

const FROM = 'Tajribah <no-reply@tajribah.org>';
const CONFIG = { host: 'smtppro.zoho.com', port: 465, user: 'info@baqah.org', password: 'app-pass-123', from: FROM };

/** A server that answers each command with the next scripted reply, recording what it was told. */
function scripted(replies: Record<string, string>, opened: { host?: string; port?: number } = {}) {
  const said: string[] = [];
  let closed = false;
  const connector: SmtpConnector = async (host, port) => {
    Object.assign(opened, { host, port });
    const out: string[] = ['220 mx.zoho.com ESMTP ready\r\n'];
    let inData = false;
    let data = '';
    return {
      async write(chunk) {
        if (inData) {
          data += chunk;
          if (data.endsWith('\r\n.\r\n')) { inData = false; said.push(`<message ${data.length} bytes>`); out.push(replies.message ?? '250 OK queued\r\n'); (said as unknown as { data: string }).data = data; }
          return;
        }
        for (const line of chunk.split('\r\n').filter(Boolean)) {
          said.push(line);
          const verb = line.split(' ')[0]!.toUpperCase();
          const key = verb === 'MAIL' ? 'MAIL' : verb === 'RCPT' ? 'RCPT' : verb;
          const reply = replies[key] ?? ({ EHLO: '250-smtppro.zoho.com\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 52428800\r\n', AUTH: '235 Authentication Successful\r\n', MAIL: '250 Sender OK\r\n', RCPT: '250 Recipient OK\r\n', DATA: '354 Ok Send data ending with <CRLF>.<CRLF>\r\n', QUIT: '221 bye\r\n' } as Record<string, string>)[key];
          if (verb === 'DATA') inData = true;
          if (reply) out.push(reply);
        }
      },
      async read() { return out.length ? out.shift()! : (closed ? null : null); },
      async close() { closed = true; },
    };
  };
  return { connector, said, isClosed: () => closed };
}

test('the whole conversation, in order: TLS port, EHLO with our domain, sign-in, sender, recipient, message, QUIT', async () => {
  const opened: { host?: string; port?: number } = {};
  const server = scripted({}, opened);
  await new SmtpEmailSender(CONFIG, () => server.connector).send({ to: 'owner@example.test', subject: 'Confirm', text: 'Hello' });
  assert.deepEqual(opened, { host: 'smtppro.zoho.com', port: 465 });
  const verbs = server.said.map((l) => l.split(' ')[0]);
  assert.deepEqual(verbs, ['EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', '<message', 'QUIT']);
  assert.equal(server.said[0], 'EHLO tajribah.org');
  assert.equal(server.said[2], 'MAIL FROM:<no-reply@tajribah.org>', 'sent from the alias');
  assert.equal(server.said[3], 'RCPT TO:<owner@example.test>');
  assert.equal(atob(server.said[1]!.split(' ')[2]!), '\0info@baqah.org\0app-pass-123', 'AUTH PLAIN: the mailbox signs in with its app password');
  assert.ok(server.isClosed(), 'the connection is closed');
});

test('a refusal names the step and the server’s words — never the password', async () => {
  const server = scripted({ AUTH: '535 Authentication Failed\r\n' });
  await assert.rejects(() => new SmtpEmailSender(CONFIG, () => server.connector).send({ to: 'a@b.test', subject: 's', text: 't' }), (error: Error) => {
    assert.match(error.message, /SMTP sign-in refused: 535 Authentication Failed/);
    assert.doesNotMatch(error.message, /app-pass-123/);
    assert.doesNotMatch(error.message, new RegExp(btoa('\0info@baqah.org\0app-pass-123').slice(0, 12)));
    return true;
  });
  assert.ok(server.isClosed(), 'closed after a failure too');
  for (const [step, key] of [['sender', 'MAIL'], ['recipient', 'RCPT'], ['message', 'message']] as const) {
    const s = scripted({ [key]: '550 No such user\r\n' });
    await assert.rejects(() => new SmtpEmailSender(CONFIG, () => s.connector).send({ to: 'a@b.test', subject: 's', text: 't' }), new RegExp(`SMTP ${step} refused: 550`));
  }
});

test('Arabic survives: the subject as a UTF-8 word, the body as base64 UTF-8; with HTML, both parts', () => {
  const mime = buildMime(FROM, { to: 'a@b.test', subject: 'أكّد بريدك — تجربة', text: 'مرحبًا بك في تجربة. الرمز 482913', html: '<p dir="rtl">مرحبًا</p>', lang: 'ar' }, new Date('2026-10-08T10:00:00Z'), 'fixed-id');
  const subject = /^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m.exec(mime)![1]!;
  assert.equal(new TextDecoder().decode(Uint8Array.from(atob(subject), (c) => c.charCodeAt(0))), 'أكّد بريدك — تجربة');
  assert.match(mime, /^From: Tajribah <no-reply@tajribah\.org>$/m);
  assert.match(mime, /^Message-ID: <fixed-id@tajribah\.org>$/m, 'the message id on our own domain');
  assert.match(mime, /^Content-Language: ar$/m);
  assert.match(mime, /multipart\/alternative; boundary="tajribah-fixed-id"/);
  const parts = [...mime.matchAll(/Content-Type: (text\/\w+); charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+)/g)];
  const decode = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\r\n/g, '')), (c) => c.charCodeAt(0)));
  assert.deepEqual(parts.map((p) => [p[1], decode(p[2]!)]), [['text/plain', 'مرحبًا بك في تجربة. الرمز 482913'], ['text/html', '<p dir="rtl">مرحبًا</p>']]);
  assert.ok(mime.split('\r\n').every((line) => line.length <= 998), 'no line over the SMTP limit');
  assert.equal(headerWord('Plain ASCII'), 'Plain ASCII');
  assert.deepEqual(parseFrom('تجربة <no-reply@tajribah.org>').address, 'no-reply@tajribah.org');
  assert.match(parseFrom('تجربة <no-reply@tajribah.org>').header, /^=\?UTF-8\?B\?.+\?= <no-reply@tajribah\.org>$/);
});

test('the dot rule: a line starting with "." is doubled, and the message ends with CRLF . CRLF', () => {
  assert.equal(dotStuff('a\r\n.hidden\r\nb'), 'a\r\n..hidden\r\nb\r\n.\r\n');
  assert.equal(dotStuff('x\n.y\n'), 'x\r\n..y\r\n.\r\n', 'bare newlines become CRLF first');
});

test('EMAIL_PROVIDER=smtp installs the Zoho sender, which asks the runtime for its socket', async () => {
  const server = scripted({});
  setSmtpConnector(server.connector);
  configureNotify({ EMAIL_PROVIDER: 'smtp', EMAIL_FROM: FROM, SMTP_USER: 'info@baqah.org', SMTP_PASSWORD: 'app-pass-123', SMS_PROVIDER: 'console' } as never);
  assert.ok(emailSender() instanceof SmtpEmailSender);
  await emailSender().send({ to: 'owner@example.test', subject: 'x', text: 'y' });
  assert.equal(server.said[0], 'EHLO tajribah.org', 'the default host and port came from the settings');
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' } as never);
});
