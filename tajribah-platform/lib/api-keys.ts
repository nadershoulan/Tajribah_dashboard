/**
 * P8 — API keys: what a key may be allowed to do, and what it looks like. Client-safe (the keys
 * screen reads it; the server enforces it in `server/modules/api-keys`).
 *
 * A key can hold only these scopes. Never money, people, the store's settings, other keys, the
 * store connections or deleting the store: those stay with a person signed in to the dashboard.
 */
import type { Permission } from './permissions';

export const API_KEY_SCOPES = [
  'products:read', 'products:write',
  'models:read', 'models:write', 'models:publish',
  'ar:read', 'ar:write', 'ar:publish',
  'tryon:read', 'tryon:write',
  'analytics:read', 'analytics:export',
] as const satisfies readonly Permission[];

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export const API_KEY_SCOPE_LABELS: Record<ApiKeyScope, { ar: string; en: string }> = {
  'products:read': { ar: 'قراءة المنتجات', en: 'Read products' },
  'products:write': { ar: 'تعديل المنتجات', en: 'Edit products' },
  'models:read': { ar: 'قراءة النماذج', en: 'Read 3D models' },
  'models:write': { ar: 'رفع النماذج وتعديلها', en: 'Upload and edit 3D models' },
  'models:publish': { ar: 'نشر النماذج', en: 'Publish 3D models' },
  'ar:read': { ar: 'قراءة إعدادات العرض', en: 'Read AR settings' },
  'ar:write': { ar: 'تعديل إعدادات العرض', en: 'Edit AR settings' },
  'ar:publish': { ar: 'نشر أزرار العرض', en: 'Publish AR buttons' },
  'tryon:read': { ar: 'قراءة التجربة الافتراضية', en: 'Read virtual try-on' },
  'tryon:write': { ar: 'تعديل التجربة الافتراضية', en: 'Edit virtual try-on' },
  'analytics:read': { ar: 'قراءة التحليلات', en: 'Read analytics' },
  'analytics:export': { ar: 'تصدير التحليلات', en: 'Export analytics' },
};

/** Every key starts with this, so a leaked one is recognisable (and secret scanners can find it). */
export const API_KEY_PREFIX = 'tjr_';
/** Characters of a key shown on screen to tell keys apart: the prefix and 8 of the secret. */
export const API_KEY_VISIBLE = API_KEY_PREFIX.length + 8;
/** Live (not revoked, not expired) keys one store may hold — a bound, not a price. */
export const MAX_LIVE_KEYS = 20;
/** Lifetimes offered, in days; null is "until revoked". */
export const API_KEY_LIFETIMES = [30, 90, 365, null] as const;
