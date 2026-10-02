/**
 * P3.10 — professional 3D models: the merchant's side (`lib/contracts/professional.ts` says what the
 * service is). Asking and cancelling need `models:write`; anyone who can see models sees the orders.
 * One open order per product — a second ask is refused, and the database's partial unique index holds
 * that even for two asks at the same moment. Every change is audited. Staff quote from the console
 * (`admin/professional.ts`).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { products, professionalOrders } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { vatOf } from '@/lib/money';
import { OPEN_STATUSES, RequestInput, type ProfessionalOrderView } from '@/lib/contracts/professional';
import { record } from '@/server/core/audit/audit';
import { errors, fieldErrorsFrom, isUniqueViolation } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';

type Order = typeof professionalOrders.$inferSelect;
type Product = typeof products.$inferSelect;

export function orderView(order: Order, product: Pick<Product, 'name' | 'nameAr'> | undefined): ProfessionalOrderView {
  const quoted = order.priceMinor != null && order.quotedAt;
  return {
    id: order.id,
    productId: order.productId,
    productName: product?.name ?? '—',
    productNameAr: product?.nameAr ?? null,
    status: order.status,
    note: order.note,
    quote: quoted
      ? { priceMinor: order.priceMinor!, vatMinor: vatOf(order.priceMinor!), totalMinor: order.priceMinor! + vatOf(order.priceMinor!), currency: order.currency, note: order.quoteNote, quotedAt: order.quotedAt!.toISOString() }
      : null,
    createdAt: order.createdAt.toISOString(),
  };
}

/** API-135 — the store's orders, newest first. */
export async function listOrders(ctx: TenantContext): Promise<ProfessionalOrderView[]> {
  ctx.require('models:read');
  const orders = await ctx.db.find(professionalOrders, undefined, { orderBy: desc(professionalOrders.createdAt), limit: 200 });
  const ids = [...new Set(orders.map((o) => o.productId))];
  const named = ids.length ? await ctx.db.find(products, inArray(products.id, ids), { limit: ids.length }) : [];
  return orders.map((o) => orderView(o, named.find((p) => p.id === o.productId)));
}

/** API-136 — ask Tajribah's team to make this product's model. */
export async function requestOrder(ctx: TenantContext, input: unknown): Promise<ProfessionalOrderView> {
  ctx.require('models:write');
  const parsed = RequestInput.safeParse(input);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  const { productId, note } = parsed.data;
  try {
    return await withTenant(ctx.tenantId, async (db) => {
      const product = await db.findById(products, productId);
      if (!product || product.deletedAt) throw errors.notFound('product');
      const open = await db.findOne(professionalOrders, and(eq(professionalOrders.productId, productId), inArray(professionalOrders.status, [...OPEN_STATUSES])));
      if (open) throw errors.conflict('this product already has an open request');
      const order = await db.insert(professionalOrders, { id: uuidv7(), tenantId: ctx.tenantId, productId, note, requestedBy: ctx.actor.userId ?? null }) as Order;
      await record(ctx, { action: 'create', resourceType: 'professional_order', resourceId: order.id, after: { productId, note } }, db);
      return orderView(order, product);
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw errors.conflict('this product already has an open request');
    throw error;
  }
}

/** API-137 — cancel before work starts: while it waits for a quote, or once quoted. */
export async function cancelOrder(ctx: TenantContext, orderId: string): Promise<ProfessionalOrderView> {
  ctx.require('models:write');
  return withTenant(ctx.tenantId, async (db) => {
    const order = await db.findById(professionalOrders, orderId);
    if (!order) throw errors.notFound('order');
    if (order.status !== 'requested' && order.status !== 'quoted') throw errors.conflict('this order can no longer be cancelled');
    const after = await db.updateById(professionalOrders, orderId, { status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() }) as Order;
    await record(ctx, { action: 'update', resourceType: 'professional_order', resourceId: orderId, before: { status: order.status }, after: { status: 'cancelled' } }, db);
    return orderView(after, await db.findById(products, order.productId) ?? undefined);
  });
}
