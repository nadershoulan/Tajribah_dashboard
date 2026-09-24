'use client';

/**
 * Where a screen gets its data.
 *
 * One interface, two implementations: the demo source (seeded, for the static preview) and
 * the API source (P1, once the endpoints exist). Screens call the hooks and never know
 * which one answered — so the preview exercises the real components, and swapping in the
 * API changes no screen code.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  DEMO_ANALYTICS, DEMO_BILLING, DEMO_DASHBOARD, DEMO_MODELS, DEMO_PRODUCTS, DEMO_TEAM,
} from './demo-data';
import type {
  AnalyticsView, BillingSummary, DashboardSummary, ModelRow, ProductRow, TeamMemberRow, TenantSummary,
} from './view-models';
import { ApiError, currentStore, type ApiClient } from './api-client';
import type { ProductListPage, ProductListQuery } from './contracts/products';
import { pageOf } from './product-list';

export interface DataSource {
  /** The store being viewed. The shell reads it on every screen for the store switcher. */
  currentTenant(): Promise<TenantSummary>;
  dashboard(): Promise<DashboardSummary>;
  /** One page of the catalogue: search, filter and cursor are the server's (P1.9). */
  products(query?: Partial<ProductListQuery>): Promise<ProductListPage>;
  product(id: string): Promise<ProductRow | null>;
  models(): Promise<ModelRow[]>;
  team(): Promise<TeamMemberRow[]>;
  billing(): Promise<BillingSummary>;
  analytics(range: '7d' | '30d' | '90d'): Promise<AnalyticsView>;
}

/**
 * The real API. The store summary (`/api/auth/me`) and the catalogue (`/api/products`, P1.8)
 * exist server-side; models, team, billing and analytics arrive with later packages. Until
 * then those screens show their error state with this message — not demo numbers passed
 * off as the merchant's own.
 */
export function apiSource(client: ApiClient): DataSource {
  const pending = (what: string) => () => Promise.reject(new ApiError(501, 'not_implemented',
    `${what} is not available yet — its API arrives with the core-loop phase (P1).`));
  return {
    async currentTenant() {
      const store = currentStore(await client.me());
      if (!store) throw new ApiError(404, 'not_found', 'no store on this account');
      return store;
    },
    dashboard: pending('The dashboard summary'),
    async products(query = {}) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
      }
      const qs = params.toString();
      return client.call<ProductListPage>(`/api/products${qs ? `?${qs}` : ''}`);
    },
    async product(id) {
      try {
        return await client.call<ProductRow>(`/api/products/${encodeURIComponent(id)}`);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    models: pending('The model library'),
    team: pending('Team management'),
    billing: pending('Billing'),
    analytics: pending('Analytics'),
  };
}

/** Seeded data, resolved on a microtask so screens exercise their loading states. */
export const demoSource: DataSource = {
  async currentTenant() { return DEMO_DASHBOARD.tenant; },
  async dashboard() { return DEMO_DASHBOARD; },
  async products(query = {}) { return pageOf(DEMO_PRODUCTS, query); },
  async product(id) { return DEMO_PRODUCTS.find((p) => p.id === id) ?? null; },
  async models() { return DEMO_MODELS; },
  async team() { return DEMO_TEAM; },
  async billing() { return DEMO_BILLING; },
  async analytics(range) {
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    const series = DEMO_ANALYTICS.series.slice(-Math.min(days, DEMO_ANALYTICS.series.length));
    return { ...DEMO_ANALYTICS, range, series };
  },
};

const DataContext = createContext<DataSource>(demoSource);

export function DataProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  return <DataContext.Provider value={source}>{children}</DataContext.Provider>;
}

export const useData = (): DataSource => useContext(DataContext);

export type Resource<T> = { data: T | null; loading: boolean; error: Error | null };

/** A stable number per data source, so a request key can tell two sources apart. */
const sourceIds = new WeakMap<DataSource, number>();
let nextSourceId = 0;
function idOf(source: DataSource): number {
  let id = sourceIds.get(source);
  if (id === undefined) { id = nextSourceId++; sourceIds.set(source, id); }
  return id;
}

/**
 * Read one resource. `deps` behaves like `useEffect`'s, and a stale response is discarded
 * rather than overwriting a newer one.
 *
 * `loading` is derived — the stored result belongs to an older request key — rather than set
 * inside the effect, which would render twice per change. While a new request is in flight
 * the previous data stays on screen (a range switch should not blank a chart).
 */
export function useResource<T>(load: (source: DataSource) => Promise<T>, deps: unknown[] = []): Resource<T> {
  const source = useData();
  const key = `${idOf(source)}:${JSON.stringify(deps)}`;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: Error | null }>({ key: null, data: null, error: null });

  useEffect(() => {
    let live = true;
    load(source)
      .then((data) => { if (live) setState({ key, data, error: null }); })
      .catch((error: Error) => { if (live) setState({ key, data: null, error }); });
    return () => { live = false; };
    // `load` is a fresh closure every render; `key` already captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, key]);

  const current = state.key === key;
  return { data: state.data, loading: !current, error: current ? state.error : null };
}
