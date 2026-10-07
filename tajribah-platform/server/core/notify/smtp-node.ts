/**
 * T112 — the SMTP socket in Node (the Node worker, scripts): implicit TLS with `node:tls`, certificate checked.
 * Never imported by the Worker, which uses `cloudflare:sockets` (`server/boot.ts`).
 */
import tls from 'node:tls';
import type { SmtpConnector } from './smtp';

export const nodeSmtpConnector: SmtpConnector = (host, port) => new Promise((resolve, reject) => {
  const socket = tls.connect({ host, port, servername: host }, () => {
    const queue: (string | null)[] = [];
    const waiting: ((chunk: string | null) => void)[] = [];
    const push = (chunk: string | null) => { const w = waiting.shift(); if (w) w(chunk); else queue.push(chunk); };
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => push(chunk));
    socket.on('end', () => push(null));
    socket.on('close', () => push(null));
    resolve({
      write: (data) => new Promise((ok, fail) => socket.write(data, (error) => (error ? fail(error) : ok()))),
      read: () => (queue.length ? Promise.resolve(queue.shift()!) : new Promise((r) => waiting.push(r))),
      close: async () => { socket.end(); },
    });
  });
  socket.setTimeout(30_000, () => socket.destroy(new Error('SMTP: no answer in 30 s')));
  socket.once('error', reject);
});
