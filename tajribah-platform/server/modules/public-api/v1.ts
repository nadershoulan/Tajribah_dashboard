/**
 * P8 — the dashboard's rows, mapped to the Public API's v1 shapes (`lib/public-api/v1.ts`). The
 * mapping is the seam: a screen may change its rows; v1 changes only here, and only by adding.
 */
import type { z } from 'zod/v4';
import type { AnalyticsV1, ModelV1, ProductV1 } from '@/lib/public-api/v1';
import type { AnalyticsView, ModelRow, ProductRow } from '@/lib/view-models';

export function productV1(row: ProductRow): z.infer<typeof ProductV1> {
  return {
    id: row.id, name: row.name, nameAr: row.nameAr, sku: row.sku, status: row.status, productType: row.productType,
    price: row.priceMinor === null ? null : { amountMinor: row.priceMinor, currency: row.currency },
    imageUrl: row.imageUrl,
    ar: { enabled: row.arEnabled, live: row.live },
    tryon: { enabled: row.tryonEnabled },
    model: { status: row.modelStatus },
    dimensions: row.dimensions ? { ...row.dimensions } : null,
    updatedAt: row.updatedAt,
  };
}

export function modelV1(row: ModelRow): z.infer<typeof ModelV1> {
  return {
    id: row.id, productId: row.productId, name: row.name, source: row.source,
    // The list never holds an archived (deleted) model; the internal type still names the state.
    status: row.status === 'archived' ? 'draft' : row.status,
    version: row.version, formats: [...row.formats], sizeBytes: row.sizeBytes, polyCount: row.polyCount,
    thumbnailUrl: row.thumbnailUrl, updatedAt: row.updatedAt,
  };
}

export function analyticsV1(view: AnalyticsView): z.infer<typeof AnalyticsV1> {
  const t = view.totals;
  return {
    range: view.range,
    totals: {
      views: t.views, arSessions: t.arSessions, tryonSessions: t.tryonSessions,
      addToCart: t.addToCart, purchases: t.purchases, revenueMinor: t.revenueMinor, upliftPct: t.upliftPct,
    },
    daily: view.series.map((p) => ({ day: p.day, views: p.views, arSessions: p.arSessions, tryonSessions: p.tryonSessions, purchases: p.purchases })),
  };
}
