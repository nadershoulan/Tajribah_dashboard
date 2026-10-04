/**
 * Products without linking a store (Nader, 2026-10-04: "like Google Merchant"):
 *
 *  - **A feed's link** (`connectFeed`) — the Google Merchant feed a store's platform publishes (Salla's
 *    "Google Merchant" app gives one). Read once to check it, then like a linked store: a full sync now,
 *    and again every 24 hours (`FEED_INTERVAL_MINUTES`). The link is sealed like a token: it usually
 *    carries a secret. Linking the same link again is the same connection.
 *  - **A file** (`importProductFile`) — CSV, TSV, XLSX or a Merchant XML file, read in the upload's own
 *    request and synced there and then; the file itself is never kept. Uploading again updates the same
 *    products (one "file" connection per store) and archives what the new file no longer has, under the
 *    engine's guard. Nothing re-reads it on a schedule.
 *
 * Every plan may do both: they are another way of adding products, which every plan has — not one of
 * the store platforms the plans list.
 */
import { and, eq } from 'drizzle-orm';
import { storeConnections } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { FEED_MAX_BYTES, feedProblem, parseFeedText, parseTable, type FeedResult } from '@/lib/product-feed';
import { readXlsx } from '@/lib/xlsx';
import type { FeedImport, SyncProgress } from '@/lib/view-models';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { FEED_INTERVAL_MINUTES, FeedError, fetchFeed, stageFile } from '@/server/connectors/feed/connector';
import { runSyncStep } from '@/server/modules/sync/engine';
import { createSyncIn, requestSync, syncProgress, toProgress } from '@/server/modules/sync/service';
import { enqueueEdgeRefresh } from '@/server/modules/edge/publish';
import { connectStore, summaryOf } from './service';

const digest = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');

/** A file connection is never re-read on a schedule: its interval is a century. */
export const FILE_INTERVAL_MINUTES = 100 * 365 * 24 * 60;
export const FILE_TYPES = ['csv', 'tsv', 'txt', 'xlsx', 'xml'] as const;

export async function connectFeed(ctx: TenantContext, input: { url: string }, fetchImpl: typeof fetch = fetch): Promise<FeedImport> {
  ctx.require('connections:write');
  const link = (input.url ?? '').trim();
  let result: FeedResult;
  try {
    result = await fetchFeed(link, fetchImpl);
  } catch (error) {
    if (error instanceof FeedError) throw errors.validation({ url: [error.message] });
    throw error;
  }
  const url = new URL(link);
  const connection = await connectStore(ctx, {
    provider: 'feed',
    externalStoreId: `${ctx.tenantId}:url:${await digest(link)}`,
    storeName: url.hostname.replace(/^www\./, ''),
    storeUrl: url.origin,
    tokens: { accessToken: `url:${link}` },
  });
  await withTenant(ctx.tenantId, (db) => db.updateById(storeConnections, connection.id, {
    syncIntervalMinutes: FEED_INTERVAL_MINUTES, settings: { kind: 'url', rows: result.rows, products: result.products.length },
  }));
  const sync = await syncFeedNow(ctx, (await requestSync(ctx, connection.id, { type: 'full' })).id);
  return { connection: await summaryOf(ctx, connection.id), rows: result.rows, products: result.products.length, skipped: result.skipped, sync };
}

/**
 * A feed's sync, run here and now rather than left for the worker: a whole feed reads in seconds (1,240
 * items in under 2 s), so the merchant sees the products at once — and on a machine with no queue consumer
 * (a local run) nothing waits forever. The every-24-hours refresh is still the scheduler's.
 */
export async function syncFeedNow(ctx: TenantContext, syncJobId: string): Promise<SyncProgress> {
  let progress: SyncProgress | null = null;
  for (let run = 0; run < 100; run++) {
    const step = await runSyncStep({ tenantId: ctx.tenantId, syncJobId, requestId: `${ctx.requestId}:feed`, maxPages: 50 });
    if (step.job) progress = toProgress(step.job);
    if (step.result !== 'more') {
      if (step.result === 'done') await enqueueEdgeRefresh(ctx.tenantId); // names and prices are in published configs
      break;
    }
  }
  return progress ?? syncProgress(ctx, syncJobId);
}

/** The file's products, whatever its kind: an Excel workbook by its zip signature, else text. */
export async function readProductFile(bytes: Uint8Array): Promise<FeedResult> {
  if (bytes.byteLength > FEED_MAX_BYTES) throw errors.validation({ file: ['the file is larger than 30 MB'] });
  let result: FeedResult;
  try {
    result = bytes[0] === 0x50 && bytes[1] === 0x4b ? parseTable(await readXlsx(bytes)) : parseFeedText(new TextDecoder().decode(bytes));
  } catch (error) {
    throw errors.validation({ file: [error instanceof Error ? error.message : 'the file could not be read'] });
  }
  const problem = feedProblem(result);
  if (problem) throw errors.validation({ file: [problem] });
  return result;
}

export async function importProductFile(ctx: TenantContext, input: { filename: string; bytes: Uint8Array }): Promise<FeedImport> {
  ctx.require('connections:write');
  ctx.require('products:write');
  const filename = (input.filename || 'products').replace(/[\\/]/g, '').slice(-120);
  const result = await readProductFile(input.bytes);

  const stage = uuidv7();
  const connection = await connectStore(ctx, {
    provider: 'feed', externalStoreId: `${ctx.tenantId}:file`, storeName: filename, storeUrl: null,
    tokens: { accessToken: `file:${stage}` },
  });
  const settings = { kind: 'file', filename, rows: result.rows, products: result.products.length };
  // Not through the queue: the products exist only in this request, so this request syncs them.
  const { job, fresh } = await withTenant(ctx.tenantId, async (db) => {
    await db.updateById(storeConnections, connection.id, { syncIntervalMinutes: FILE_INTERVAL_MINUTES, settings });
    return createSyncIn(ctx, db, connection.id, { type: 'full', triggeredBy: 'user' });
  });
  if (!fresh) throw errors.conflict('the last file is still being imported — try again in a minute');
  const release = stageFile(stage, result);
  let sync = toProgress(job);
  try {
    for (let run = 0; run < 100; run++) {
      const step = await runSyncStep({ tenantId: ctx.tenantId, syncJobId: job.id, requestId: `${ctx.requestId}:file`, maxPages: 50 });
      if (step.job) sync = toProgress(step.job);
      if (step.result !== 'more') break;
    }
  } finally {
    release();
  }
  return { connection: await summaryOf(ctx, connection.id), rows: result.rows, products: result.products.length, skipped: result.skipped, sync };
}

/** The store's file connection, if a file was ever imported. */
export async function fileConnectionOf(ctx: TenantContext) {
  return ctx.db.findOne(storeConnections, and(eq(storeConnections.provider, 'feed'), eq(storeConnections.externalStoreId, `${ctx.tenantId}:file`)));
}
