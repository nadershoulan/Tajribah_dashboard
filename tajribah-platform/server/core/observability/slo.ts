/**
 * P7 — the service level objectives (plan §SLOs), as data: what the code measures itself against.
 *
 * Every request's access line carries its budget (`budgetMs`), and one over it is also logged as
 * `slow request`. A p95 objective is about the share of requests over the budget, not any single
 * one: "slow request" lines over "request" lines for a route, over a window, is the number to
 * watch and to alert on once the log service exists (plan §4: Axiom or Grafana Cloud).
 */
export const SLO = {
  viewerConfigP95Ms: 50,
  modelDownloadStartP95Ms: 200,
  arInteractiveP95Ms: 3000,
  apiReadP95Ms: 300,
  apiWriteP95Ms: 800,
  eventIngestP99Ms: 100,
  uptimeShopperPct: 99.95,
  uptimeDashboardPct: 99.9,
} as const;

/**
 * The paths that are not dashboard API calls, with their own objective. The event collector is
 * served at `ev.tajribah.com/v1/e` (GO-LIVE §5, the widget's `DEFAULT_EVENTS`); in this app it is
 * `/api/analytics/collect` — both carry the ingest budget, whichever serves it.
 */
const PATH_BUDGETS: Record<string, number> = {
  '/api/analytics/collect': SLO.eventIngestP99Ms,
  '/v1/e': SLO.eventIngestP99Ms,
};

/** The time budget of one request: event ingest has its own; otherwise reads 300 ms, writes 800 ms. */
export function budgetMs(method: string, path: string): number {
  return PATH_BUDGETS[path] ?? (method === 'GET' || method === 'HEAD' ? SLO.apiReadP95Ms : SLO.apiWriteP95Ms);
}
