/**
 * P2.6 — invoices and VAT.
 *
 * Rules that are not style choices:
 *  - **Gapless numbers per store per year** (§7.4 rule 3). The number is allocated from
 *    `invoice_sequences` by one upsert *inside the invoice's own transaction*: the row lock it
 *    takes queues concurrent issues, and a rollback returns the number with everything else —
 *    never `count(*) + 1`, never a Postgres sequence (those skip on rollback).
 *  - **An invoice is issued complete and never edited.** Seller and buyer are snapshotted onto
 *    the row; later changes to either never reach an invoice already sent.
 *  - **No seller VAT number, no tax invoice.** Until SRO Company's own TRN is configured
 *    (`server/core/billing/seller.ts`) issuing refuses, rather than print a wrong or empty one.
 *  - The ZATCA fields (UUID, hash, QR) are the certified provider's (P2.7); nothing here
 *    computes them.
 *
 * Numbers read `TJ-2026-A1B2C3D4-000001`: the year, the store (the last 8 characters of its
 * id — stable, unlike the slug), and the store's own sequence. The store part keeps
 * `invoice_number` unique across stores, which the table requires.
 */
import { desc, eq, sql } from 'drizzle-orm';
import { invoiceLines, invoiceSequences, invoices, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import {
  priceInvoiceLines, VAT_RATE_BP,
  type InvoiceDocument, type InvoiceLineInput, type InvoiceParty,
} from '@/lib/contracts/invoices';
import { VAT_NUMBER } from '@/lib/contracts/settings';
import { record } from '@/server/core/audit/audit';
import { SELLER, type Seller } from '@/server/core/billing/seller';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { withTenant } from '@/server/core/tenancy/rls';

/** Riyadh calendar year of an instant (UTC+3, no DST). */
export const riyadhYear = (at: Date) => new Date(at.getTime() + 3 * 60 * 60 * 1000).getUTCFullYear();

/**
 * The next number in this store's sequence for `year`, inside the caller's transaction.
 * First invoice of the year: the row is created at 2 and 1 is returned. The upsert holds the
 * row lock until commit, so a second issue waits, and a rollback gives the number back.
 */
export async function allocateInvoiceNumber(db: TenantDb, year: number): Promise<number> {
  const row = await db.upsert(
    invoiceSequences,
    { year, nextNumber: 2 } as never,
    [invoiceSequences.tenantId, invoiceSequences.year],
    { nextNumber: sql`${invoiceSequences.nextNumber} + 1` } as never,
  );
  return row.nextNumber - 1;
}

export const invoiceNumber = (tenantId: string, year: number, n: number) =>
  `TJ-${year}-${tenantId.replace(/-/g, '').slice(-8).toUpperCase()}-${String(n).padStart(6, '0')}`;

export type IssueInvoiceInput = {
  lines: InvoiceLineInput[];
  subscriptionId?: string | null;
  issuedAt?: Date;
  /** Card payments are paid at issue; a bank transfer is due later. */
  paid?: boolean;
  dueInDays?: number;
};

/**
 * Issue one invoice to the store in `ctx`. Everything — number, parties, lines, audit row —
 * commits together or not at all. `seller` is injectable for tests only.
 */
export async function issueInvoice(ctx: TenantContext, input: IssueInvoiceInput, seller: Seller = SELLER): Promise<InvoiceDocument> {
  ctx.require('billing:write');
  const sellerVat = VAT_NUMBER.safeParse(seller.vatNumber);
  if (!sellerVat.success || !sellerVat.data) {
    throw errors.conflict("the seller's VAT number is not configured — a tax invoice cannot be issued");
  }
  let priced;
  try {
    priced = priceInvoiceLines(input.lines, VAT_RATE_BP);
  } catch (error) {
    throw errors.validation({ lines: [(error as Error).message] });
  }
  const issuedAt = input.issuedAt ?? new Date();

  const id = await withTenant(ctx.tenantId, async (db) => {
    const buyer = await db.requireById(tenants, ctx.tenantId);
    const n = await allocateInvoiceNumber(db, riyadhYear(issuedAt));
    const row = await db.insert(invoices, {
      id: uuidv7(),
      invoiceNumber: invoiceNumber(ctx.tenantId, riyadhYear(issuedAt), n),
      subscriptionId: input.subscriptionId ?? null,
      status: input.paid ? 'paid' : 'issued',
      subtotalMinor: priced.subtotalMinor,
      vatRateBp: priced.vatRateBp,
      vatMinor: priced.vatMinor,
      totalMinor: priced.totalMinor,
      issuedAt,
      dueAt: new Date(issuedAt.getTime() + (input.dueInDays ?? 0) * 86_400_000),
      paidAt: input.paid ? issuedAt : null,
      sellerName: seller.nameEn,
      sellerNameAr: seller.nameAr,
      sellerCrNumber: seller.crNumber,
      sellerVatNumber: seller.vatNumber,
      sellerAddress: seller.nationalAddress,
      buyerName: buyer.name,
      buyerNameAr: buyer.nameAr,
      buyerCrNumber: buyer.crNumber,
      buyerVatNumber: buyer.vatNumber,
      buyerAddress: [buyer.nationalAddress, buyer.city].filter(Boolean).join(', ') || null,
    } as never);
    await db.insert(invoiceLines, priced.lines.map((line) => ({
      id: uuidv7(),
      invoiceId: row.id,
      description: line.description,
      descriptionAr: line.descriptionAr,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      amountMinor: line.amountMinor,
      taxMinor: line.taxMinor,
    })) as never);
    await record(ctx, { action: 'create', resourceType: 'invoice', resourceId: row.id, after: row as never }, db);
    return row.id;
  });
  return (await invoiceOf(ctx, id))!;
}

type InvoiceRowDb = typeof invoices.$inferSelect;

const party = (name: string | null, nameAr: string | null, cr: string | null, vat: string | null, address: string | null): InvoiceParty =>
  ({ name: name ?? '', nameAr, crNumber: cr, vatNumber: vat, address });

function documentOf(row: InvoiceRowDb, lines: (typeof invoiceLines.$inferSelect)[]): InvoiceDocument {
  return {
    id: row.id,
    number: row.invoiceNumber,
    status: row.status,
    kind: row.buyerVatNumber ? 'standard' : 'simplified',
    currency: row.currency,
    issuedAt: (row.issuedAt ?? row.createdAt).toISOString(),
    dueAt: row.dueAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    seller: party(row.sellerName, row.sellerNameAr, row.sellerCrNumber, row.sellerVatNumber, row.sellerAddress),
    buyer: party(row.buyerName, row.buyerNameAr, row.buyerCrNumber, row.buyerVatNumber, row.buyerAddress),
    lines: lines.map((l) => ({
      description: l.description, descriptionAr: l.descriptionAr, quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor, amountMinor: l.amountMinor, taxMinor: l.taxMinor,
    })),
    subtotalMinor: row.subtotalMinor,
    vatRateBp: row.vatRateBp,
    vatMinor: row.vatMinor,
    totalMinor: row.totalMinor,
    zatca: { status: row.zatcaStatus, qr: row.zatcaQr },
  };
}

/** One invoice with its lines, or null — another store's invoice is simply not found. */
export async function invoiceOf(ctx: TenantContext, id: string): Promise<InvoiceDocument | null> {
  ctx.require('billing:read');
  const row = await ctx.db.findById(invoices, id);
  if (!row) return null;
  const lines = await ctx.db.find(invoiceLines, eq(invoiceLines.invoiceId, id), { limit: 200 });
  return documentOf(row, lines);
}

export type InvoiceSummary = Pick<InvoiceDocument, 'id' | 'number' | 'status' | 'subtotalMinor' | 'vatMinor' | 'totalMinor' | 'currency' | 'issuedAt' | 'paidAt'> & {
  zatcaStatus: InvoiceDocument['zatca']['status'];
};

/** This store's invoices, newest first. */
export async function invoicesOf(ctx: TenantContext): Promise<InvoiceSummary[]> {
  ctx.require('billing:read');
  const rows = await ctx.db.find(invoices, undefined, { limit: 200, orderBy: desc(invoices.issuedAt) });
  return rows.map((row) => ({
    id: row.id, number: row.invoiceNumber, status: row.status, subtotalMinor: row.subtotalMinor,
    vatMinor: row.vatMinor, totalMinor: row.totalMinor, currency: row.currency,
    issuedAt: (row.issuedAt ?? row.createdAt).toISOString(), paidAt: row.paidAt?.toISOString() ?? null,
    zatcaStatus: row.zatcaStatus,
  }));
}

