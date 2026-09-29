/**
 * P8 — the Public API, version 1: what it answers, as schemas — the single source for the
 * responses (checked in tests), and for the OpenAPI document developers read.
 *
 * A v1 shape is a promise: fields are added, never renamed or removed, while v1 lives. So these
 * are their own types, mapped from the dashboard's (`server/modules/public-api/v1.ts`) — a change
 * to a screen can never change what an integration receives. Objects are strict: a field that is
 * not written here is a test failure, not a quiet leak.
 */
import { z } from 'zod/v4';
import { API_KEY_SCOPES } from '@/lib/api-keys';

export const V1 = z.registry<{ id: string; description?: string }>();

export const ProductV1 = z.strictObject({
  id: z.string().describe('Tajribah product id (uuid).'),
  name: z.string(),
  nameAr: z.string().nullable(),
  sku: z.string().nullable(),
  status: z.enum(['active', 'draft', 'archived']),
  productType: z.enum(['jewelry', 'watch', 'eyewear', 'bag', 'apparel', 'furniture', 'other']),
  price: z.strictObject({
    amountMinor: z.number().int().describe('In the currency\'s minor unit (halalas for SAR).'),
    currency: z.string().describe('ISO 4217, e.g. SAR.'),
  }).nullable(),
  imageUrl: z.string().nullable(),
  ar: z.strictObject({
    enabled: z.boolean(),
    live: z.boolean().describe('Its "View in your space" button is on the shop now.'),
  }),
  tryon: z.strictObject({ enabled: z.boolean() }),
  model: z.strictObject({ status: z.enum(['none', 'processing', 'ready', 'failed']) }),
  dimensions: z.strictObject({
    widthMm: z.number().optional(), heightMm: z.number().optional(), depthMm: z.number().optional(), caseMm: z.number().optional(),
  }).nullable().describe('Millimetres.'),
  updatedAt: z.string().describe('ISO 8601.'),
}).register(V1, { id: 'Product', description: 'A product in the store\'s catalogue.' });

export const ModelV1 = z.strictObject({
  id: z.string(),
  productId: z.string().nullable(),
  name: z.string(),
  source: z.enum(['uploaded', 'ai_generated', 'professional_service']),
  status: z.enum(['draft', 'processing', 'ready', 'failed']),
  version: z.number().int(),
  formats: z.array(z.enum(['glb', 'usdz'])),
  sizeBytes: z.number().int().describe('The optimised GLB.'),
  polyCount: z.number().int().nullable(),
  thumbnailUrl: z.string().nullable(),
  updatedAt: z.string(),
}).register(V1, { id: 'Model', description: 'A 3D model and its current version.' });

export const DayV1 = z.strictObject({
  day: z.string().describe('YYYY-MM-DD, Riyadh time.'),
  views: z.number().int(), arSessions: z.number().int(), tryonSessions: z.number().int(), purchases: z.number().int(),
}).register(V1, { id: 'Day' });

export const AnalyticsV1 = z.strictObject({
  range: z.enum(['7d', '30d', '90d']),
  totals: z.strictObject({
    views: z.number().int(), arSessions: z.number().int(), tryonSessions: z.number().int(),
    addToCart: z.number().int(), purchases: z.number().int(), revenueMinor: z.number().int(),
    upliftPct: z.number().nullable().describe('Conversion with AR minus without it, in points; null until there is enough data.'),
  }),
  daily: z.array(DayV1),
}).register(V1, { id: 'Analytics', description: 'The store\'s figures over a range.' });

export const ProductPageV1 = z.strictObject({
  data: z.array(ProductV1),
  nextCursor: z.string().nullable().describe('Pass as `cursor` for the next page; null on the last.'),
}).register(V1, { id: 'ProductPage' });

export const ModelListV1 = z.strictObject({ data: z.array(ModelV1) }).register(V1, { id: 'ModelList' });

export const ProblemV1 = z.object({
  type: z.string(), title: z.string(), status: z.number().int(), code: z.string(),
  detail: z.string().optional(), requestId: z.string().optional(), retryAfter: z.number().int().optional(),
}).register(V1, { id: 'Problem', description: 'Every error, as application/problem+json (RFC 9457).' });

/** Requests one key may make per minute. Answers carry `X-RateLimit-Limit` / `-Remaining`. */
export const V1_RATE = { limit: 600, windowSeconds: 60 } as const;

/** [method, path, scope, summary, response schema id, query parameters] — the routes v1 serves. */
export const V1_ROUTES = [
  ['get', '/api/v1/products', 'products:read', 'List products, newest first', 'ProductPage', ['limit', 'cursor']],
  ['get', '/api/v1/products/{id}', 'products:read', 'One product', 'Product', []],
  ['get', '/api/v1/models', 'models:read', 'Every 3D model not deleted, most recently changed first (up to 500)', 'ModelList', []],
  ['get', '/api/v1/analytics', 'analytics:read', 'The store\'s figures over a range', 'Analytics', ['range']],
] as const;

const PARAMETERS: Record<string, unknown> = {
  limit: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  cursor: { name: 'cursor', in: 'query', schema: { type: 'string' }, description: '`nextCursor` from the previous page.' },
  range: { name: 'range', in: 'query', schema: { type: 'string', enum: ['7d', '30d', '90d'], default: '30d' } },
};

/** The OpenAPI 3.1 document — built from the schemas above, never written by hand. */
export function openApiDocument(serverUrl: string): Record<string, unknown> {
  const { schemas } = z.toJSONSchema(V1, { uri: (id) => `#/components/schemas/${id}` }) as { schemas: Record<string, Record<string, unknown>> };
  for (const schema of Object.values(schemas)) { delete schema.$schema; delete schema.id; }
  const problem = { description: 'An error', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } } } };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [method, path, scope, summary, response, query] of V1_ROUTES) {
    paths[path] = {
      ...paths[path],
      [method]: {
        summary, security: [{ apiKey: [] }], 'x-scope': scope,
        parameters: [
          ...(path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] : []),
          ...query.map((name) => PARAMETERS[name]),
        ],
        responses: {
          200: { description: 'OK', content: { 'application/json': { schema: { $ref: `#/components/schemas/${response}` } } } },
          401: problem, 402: problem, 403: problem, 404: problem, 429: problem,
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Tajribah Public API', version: '1',
      description: `Read your store's catalogue, 3D models and figures. Authenticate with a key from Settings → API keys (Enterprise): \`Authorization: Bearer tjr_…\`. A key acts as the person who made it, within its scopes (${API_KEY_SCOPES.join(', ')}). ${V1_RATE.limit} requests per minute per key.`,
    },
    servers: [{ url: serverUrl }],
    components: { schemas, securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'An API key: tjr_…' } } },
    paths,
  };
}
