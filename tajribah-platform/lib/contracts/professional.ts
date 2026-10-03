/**
 * P3.10 — a professional 3D model, made by Tajribah's team for one product: what the website sells
 * as "Professional 3D modelling — priced per product". Shared by the API, the merchant's screen and
 * the staff console.
 *
 * The merchant asks, with a note (what to watch for: a reflective case, a hinge, the exact colour);
 * staff look at the product and its photos and quote a price, VAT added at checkout (§11); the
 * merchant sees the quote. Paying — and so the work starting and the model being delivered — opens
 * with the payment gateway (P2.3), as the billing screen's pay step does. Before work starts the
 * merchant may cancel (the website's refund terms: fully refundable before work starts).
 */
import { z } from 'zod';
import type { Bi } from '../lang';

export const PROFESSIONAL_STATUS = ['requested', 'quoted', 'accepted', 'delivered', 'cancelled'] as const;
export type ProfessionalStatus = (typeof PROFESSIONAL_STATUS)[number];
export const OPEN_STATUSES: readonly ProfessionalStatus[] = ['requested', 'quoted', 'accepted'];

export const STATUS_LABEL: Record<ProfessionalStatus, Bi> = {
  requested: { ar: 'بانتظار عرض السعر', en: 'Waiting for a quote' },
  quoted: { ar: 'وصل عرض السعر', en: 'Quote ready' },
  accepted: { ar: 'قيد التنفيذ', en: 'In progress' },
  delivered: { ar: 'سُلّم النموذج', en: 'Model delivered' },
  cancelled: { ar: 'أُلغي', en: 'Cancelled' },
};

export const RequestInput = z.object({
  productId: z.string().uuid(),
  note: z.string().trim().max(1000, 'at most 1000 characters').nullish().transform((v) => (v ? v : null)),
}).strict();

/** Staff: the price in halalas before VAT, and a note the merchant reads. */
export const QuoteInput = z.object({
  priceMinor: z.number().int('whole halalas').min(100, 'at least 1 riyal').max(10_000_000, 'at most 100,000 riyals'),
  note: z.string().trim().max(1000, 'at most 1000 characters').nullish().transform((v) => (v ? v : null)),
}).strict();

export type ProfessionalOrderView = {
  id: string;
  productId: string;
  productName: string;
  productNameAr: string | null;
  status: ProfessionalStatus;
  note: string | null;
  /** The quote: before VAT, its VAT and the total, in halalas; null until staff quote. */
  quote: { priceMinor: number; vatMinor: number; totalMinor: number; currency: string; note: string | null; quotedAt: string } | null;
  /** T68: the merchant accepted the quote (then: waiting for the bank transfer). */
  acceptedAt: string | null;
  /** Payment received (staff recorded it): work started. */
  paidAt: string | null;
  /** The delivered model, to publish from 3D models. */
  deliveredModelId: string | null;
  createdAt: string;
};

/** Staff: the bank transfer's reference, as on the statement. */
export const PaidInput = z.object({ reference: z.string().trim().min(3, 'the transfer’s reference').max(100) }).strict();

/**
 * T68 — the price list (before VAT), from Saudi freelance and studio rates for product models. Staff
 * pick a tier or type another price; the merchant sees the list before asking; the website says "from".
 */
export const PRICE_TIERS: { key: 'simple' | 'standard' | 'detailed'; priceMinor: number; days: number; label: Bi; examples: Bi }[] = [
  { key: 'simple', priceMinor: 34_900, days: 5, label: { ar: 'بسيط', en: 'Simple' }, examples: { ar: 'علبة، قارورة، حقيبة بلا معادن', en: 'A box, a bottle, a bag without hardware' } },
  { key: 'standard', priceMinor: 64_900, days: 5, label: { ar: 'قياسي', en: 'Standard' }, examples: { ar: 'ساعة، نظارة، حذاء، قطعة أثاث', en: 'A watch, glasses, a shoe, a piece of furniture' } },
  { key: 'detailed', priceMinor: 114_900, days: 7, label: { ar: 'مفصّل', en: 'Detailed' }, examples: { ar: 'مجوهرات، معدن لامع، أحجار، تفاصيل دقيقة', en: 'Jewellery, polished metal, stones, fine hardware' } },
];
/** Changes included in every price. */
export const INCLUDED_REVISIONS = 2;
