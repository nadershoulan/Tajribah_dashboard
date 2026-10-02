/**
 * P3.10 — professional 3D models: the staff side. Every store's orders, those waiting for a quote
 * first; a quote is a price in halalas before VAT and a note, recorded in the staff trail and the
 * store's own activity, and the merchant is told in the dashboard. A quote can be revised until the
 * order is paid for (which opens with the payment gateway, P2.3) or cancelled.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { generationPhotos, products, professionalOrders, tenants } from '@/db/schema';
import { formatMoney } from '@/lib/money';
import { QuoteInput, type ProfessionalOrderView, type ProfessionalStatus } from '@/lib/contracts/professional';
import { record } from '@/server/core/audit/audit';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import { withTenant } from '@/server/core/tenancy/rls';
import { notifyIn } from '@/server/modules/notifications/service';
import { orderView } from '@/server/modules/professional/service';
import { staffLog, type StaffContext } from './access';
import { staffActingContext } from './stores';

export type StaffOrderRow = ProfessionalOrderView & {
  store: { id: string; name: string; nameAr: string | null };
  /** The product's measurements and how many reference photos the merchant has uploaded (P3.3). */
  product: { dimensions: unknown; photos: number };
};

/** API-A45 — the queue for one status (requested first, oldest first), with counts for the tabs. */
export async function professionalQueue(status: ProfessionalStatus = 'requested', limit = 100): Promise<{ rows: StaffOrderRow[]; counts: Record<ProfessionalStatus, number> }> {
  const db = unsafeAdminDb(); // staff read across every store (A1)
  const byStatus = await db.select({ status: professionalOrders.status, n: sql<number>`count(*)::int` }).from(professionalOrders).groupBy(professionalOrders.status);
  const counts: Record<ProfessionalStatus, number> = { requested: 0, quoted: 0, accepted: 0, delivered: 0, cancelled: 0 };
  for (const row of byStatus) counts[row.status] = Number(row.n);
  const found = await db.select({ order: professionalOrders, tenant: tenants, product: products }).from(professionalOrders)
    .innerJoin(tenants, eq(tenants.id, professionalOrders.tenantId))
    .innerJoin(products, eq(products.id, professionalOrders.productId))
    .where(eq(professionalOrders.status, status))
    .orderBy(status === 'requested' ? asc(professionalOrders.createdAt) : desc(professionalOrders.updatedAt))
    .limit(Math.min(limit, 200));
  const productIds = found.map((f) => f.product.id);
  const photoCounts = productIds.length
    ? await db.select({ productId: generationPhotos.productId, n: sql<number>`count(*)::int` }).from(generationPhotos)
      .where(and(inArray(generationPhotos.productId, productIds), eq(generationPhotos.status, 'accepted'))).groupBy(generationPhotos.productId)
    : [];
  return {
    counts,
    rows: found.map(({ order, tenant, product }) => ({
      ...orderView(order, product),
      store: { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr },
      product: { dimensions: product.dimensions, photos: Number(photoCounts.find((p) => p.productId === product.id)?.n ?? 0) },
    })),
  };
}

/** API-A46 — quote (or re-quote) an order that has not been paid for. */
export async function quoteOrder(staff: StaffContext, orderId: string, input: unknown): Promise<ProfessionalOrderView> {
  const parsed = QuoteInput.safeParse(input);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  const { priceMinor, note } = parsed.data;
  const db = unsafeAdminDb();
  const [found] = await db.select({ order: professionalOrders, tenant: tenants }).from(professionalOrders)
    .innerJoin(tenants, eq(tenants.id, professionalOrders.tenantId)).where(eq(professionalOrders.id, orderId)).limit(1);
  if (!found) throw errors.notFound('order');
  const ctx = staffActingContext(found.tenant, staff, ['models:read', 'models:write']);
  const view = await withTenant(found.tenant.id, async (tdb) => {
    const before = await tdb.lockById(professionalOrders, orderId);
    if (before.status !== 'requested' && before.status !== 'quoted') throw errors.conflict('only an order waiting for a quote, or quoted and not yet paid, can be quoted');
    const after = await tdb.updateById(professionalOrders, orderId, { status: 'quoted', priceMinor, quoteNote: note, quotedAt: new Date(), quotedBy: staff.userId, updatedAt: new Date() });
    await record(ctx, { action: 'update', resourceType: 'professional_order', resourceId: orderId, before: { status: before.status, priceMinor: before.priceMinor }, after: { status: 'quoted', priceMinor, quoteNote: note } }, tdb);
    const product = await tdb.findById(products, before.productId);
    const name = { ar: product?.nameAr ?? product?.name ?? '', en: product?.name ?? '' };
    await notifyIn(tdb, {
      type: 'professional.quoted', permission: 'models:read', level: 'info', href: '/dashboard/models',
      title: { ar: `عرض سعر لنموذج «${name.ar}» الاحترافي`, en: `A quote for “${name.en}”’s professional model` },
      body: { ar: `${formatMoney(priceMinor, 'SAR', 'ar')} قبل الضريبة`, en: `${formatMoney(priceMinor, 'SAR', 'en')} before VAT` },
    });
    return orderView(after as typeof professionalOrders.$inferSelect, product ?? undefined);
  });
  await staffLog(staff, { action: 'professional.quote', targetType: 'professional_order', targetId: orderId, storeId: found.tenant.id, reason: note, detail: { priceMinor } });
  return view;
}
