/**
 * P8 — outgoing webhooks: the events a store's own systems can be told about, and how a delivery
 * is signed. Client-safe (the webhooks screen reads it; `server/modules/outgoing-webhooks` sends).
 *
 * Each event's `data` is the Public API's v1 shape of the thing (`lib/public-api/v1.ts`), so an
 * integration reads one format whether it asked or was told.
 */
export const WEBHOOK_EVENTS = [
  'product.created', 'product.updated', 'product.deleted',
  'model.published',
  'ai_job.finished',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'ping';

export const WEBHOOK_EVENT_LABELS: Record<(typeof WEBHOOK_EVENTS)[number], { ar: string; en: string }> = {
  'product.created': { ar: 'أُضيف منتج', en: 'A product was added' },
  'product.updated': { ar: 'عُدّل منتج', en: 'A product was changed' },
  'product.deleted': { ar: 'حُذف منتج', en: 'A product was deleted' },
  'model.published': { ar: 'نُشر نموذج ثلاثي الأبعاد', en: 'A 3D model was published' },
  'ai_job.finished': { ar: 'انتهى عمل للذكاء الاصطناعي', en: 'An AI job finished' },
};

/** Every signing secret starts with this. */
export const WEBHOOK_SECRET_PREFIX = 'whsec_';
/** The header carrying `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`. */
export const SIGNATURE_HEADER = 'tajribah-signature';
/** Endpoints one store may have. A bound, not a price. */
export const MAX_ENDPOINTS = 10;
/** Minutes between tries after the first: 7 tries over about 21 hours. */
export const RETRY_MINUTES = [1, 5, 30, 120, 360, 720] as const;
/** Deliveries in a row that failed every try before the platform turns the endpoint off. */
export const DISABLE_AFTER = 15;
