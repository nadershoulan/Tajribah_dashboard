/**
 * P3.10 — professional 3D models: the staff side. Every store's orders, those waiting for a quote
 * first; a quote is a price in halalas before VAT and a note, recorded in the staff trail and the
 * store's own activity, and the merchant is told in the dashboard. A quote can be revised until the
 * order is paid for (which opens with the payment gateway, P2.3) or cancelled.
 */
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { generationPhotos, models3d, modelVersions, products, professionalOrders, tenants } from '@/db/schema';
import { formatMoney } from '@/lib/money';
import { PaidInput, PRICE_TIERS, QuoteInput, type ProfessionalOrderView, type ProfessionalStatus } from '@/lib/contracts/professional';
import { confirmUpload, startUpload } from '@/server/modules/models/service';
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
    if (before.acceptedAt) throw errors.conflict('the merchant accepted this quote — it can no longer change');
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

type StaffAct = { order: typeof professionalOrders.$inferSelect; tenant: typeof tenants.$inferSelect };
async function orderOf(orderId: string): Promise<StaffAct> {
  const [found] = await unsafeAdminDb().select({ order: professionalOrders, tenant: tenants }).from(professionalOrders)
    .innerJoin(tenants, eq(tenants.id, professionalOrders.tenantId)).where(eq(professionalOrders.id, orderId)).limit(1);
  if (!found) throw errors.notFound('order');
  return found;
}

/** The days the price list promises for this price (the tier it matches, else the longest). */
const promisedDays = (priceMinor: number | null) => PRICE_TIERS.find((t) => t.priceMinor === priceMinor)?.days ?? Math.max(...PRICE_TIERS.map((t) => t.days));

/** API-A47 — the bank transfer arrived (T68): record its reference; work starts; the merchant is told. */
export async function markPaid(staff: StaffContext, orderId: string, input: unknown): Promise<ProfessionalOrderView> {
  const parsed = PaidInput.safeParse(input);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  const { tenant } = await orderOf(orderId);
  const ctx = staffActingContext(tenant, staff, ['models:read', 'models:write']);
  const view = await withTenant(tenant.id, async (tdb) => {
    const before = await tdb.lockById(professionalOrders, orderId);
    if (before.status !== 'quoted' || !before.acceptedAt) throw errors.conflict('only a quote the merchant accepted can be marked paid');
    const after = await tdb.updateById(professionalOrders, orderId, { status: 'accepted', paidAt: new Date(), paymentReference: parsed.data.reference, updatedAt: new Date() });
    await record(ctx, { action: 'update', resourceType: 'professional_order', resourceId: orderId, before: { status: before.status }, after: { status: 'accepted', paymentReference: parsed.data.reference } }, tdb);
    const product = await tdb.findById(products, before.productId);
    const days = promisedDays(before.priceMinor);
    await notifyIn(tdb, {
      type: 'professional.paid', permission: 'models:read', level: 'success', href: `/dashboard/products/${before.productId}`,
      title: { ar: `وصلت دفعتك — بدأ العمل على نموذج «${product?.nameAr ?? product?.name ?? ''}»`, en: `Payment received — work started on “${product?.name ?? ''}”’s model` },
      body: { ar: `يجهز خلال ${days} أيام عمل.`, en: `Ready in ${days} working days.` },
    });
    return orderView(after as typeof professionalOrders.$inferSelect, product ?? undefined);
  });
  await staffLog(staff, { action: 'professional.paid', targetType: 'professional_order', targetId: orderId, storeId: tenant.id, reason: parsed.data.reference, detail: null });
  return view;
}

/** API-A48 — where to upload the finished model: a new version of the product's model, made by our team. */
export async function startDelivery(staff: StaffContext, orderId: string, input: { filename: string; sizeBytes: number }) {
  const { order, tenant } = await orderOf(orderId);
  if (order.status !== 'accepted') throw errors.conflict('only a paid order in progress can be delivered');
  const ctx = staffActingContext(tenant, staff, ['models:read', 'models:write']);
  return startUpload(ctx, { filename: input.filename, sizeBytes: input.sizeBytes, productId: order.productId, source: 'professional_service' });
}

/** API-A49 — the file arrived: checked like any upload, then the order is delivered and the merchant told. */
export async function confirmDelivery(staff: StaffContext, orderId: string, input: { versionId: string }): Promise<ProfessionalOrderView> {
  const { order, tenant } = await orderOf(orderId);
  if (order.status !== 'accepted') throw errors.conflict('only a paid order in progress can be delivered');
  const ctx = staffActingContext(tenant, staff, ['models:read', 'models:write']);
  const owned = await withTenant(tenant.id, async (tdb) => {
    const version = await tdb.findById(modelVersions, input.versionId);
    const model = version ? await tdb.findById(models3d, version.modelId) : null;
    return version && model && model.productId === order.productId ? { version, model } : null;
  });
  if (!owned) throw errors.conflict('that file is not for this order’s product');
  const confirmed = await confirmUpload(ctx, input.versionId);
  if (confirmed.status === 'failed') throw errors.validation({ file: [confirmed.error ?? 'the file was refused'] });
  const view = await withTenant(tenant.id, async (tdb) => {
    const after = await tdb.updateById(professionalOrders, orderId, { status: 'delivered', deliveredModelId: owned.model.id, deliveredVersionId: owned.version.id, deliveredAt: new Date(), updatedAt: new Date() });
    await record(ctx, { action: 'update', resourceType: 'professional_order', resourceId: orderId, before: { status: 'accepted' }, after: { status: 'delivered', modelId: owned.model.id, versionId: owned.version.id } }, tdb);
    const product = await tdb.findById(products, order.productId);
    await notifyIn(tdb, {
      type: 'professional.delivered', permission: 'models:read', level: 'success', href: '/dashboard/models',
      title: { ar: `نموذج «${product?.nameAr ?? product?.name ?? ''}» الاحترافي جاهز`, en: `“${product?.name ?? ''}”’s professional model is ready` },
      body: { ar: 'راجعه وانشره من «النماذج ثلاثية الأبعاد».', en: 'Review it and publish it from “3D models”.' },
    });
    return orderView(after as typeof professionalOrders.$inferSelect, product ?? undefined);
  });
  await staffLog(staff, { action: 'professional.deliver', targetType: 'professional_order', targetId: orderId, storeId: tenant.id, reason: null, detail: { versionId: input.versionId } });
  return view;
}
