/**
 * P1.7 — the inbound webhook endpoint. No session and no same-origin check: the caller is
 * a store's server, and the signature is the authentication.
 */
import { route } from '@/server/core/observability/request';
import { json } from '@/server/core/http/api';
import { errors } from '@/server/core/errors/problem';
import { ingest, MAX_WEBHOOK_BYTES } from './ingest';

/** API-040 — POST /api/webhooks/[provider] */
export const receiveWebhookHandler = route(async (request) => {
  const provider = new URL(request.url).pathname.split('/').filter(Boolean).pop() ?? '';
  // Refuse an oversized body before reading it; `ingest` re-checks what actually arrived.
  if (Number(request.headers.get('content-length') ?? 0) > MAX_WEBHOOK_BYTES) {
    throw errors.validation({ body: [`larger than ${MAX_WEBHOOK_BYTES} bytes`] });
  }
  // The raw text, never `request.json()`: the signature covers these exact bytes.
  const result = await ingest(provider, await request.text(), request.headers);
  return json({ outcome: result.outcome }, { status: result.outcome === 'accepted' ? 202 : 200 });
});
