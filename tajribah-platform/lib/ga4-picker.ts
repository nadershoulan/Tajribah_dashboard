/**
 * T69 — the Google sign-in that picks a GA4 measurement id, over the API (`server/modules/google/http.ts`).
 * `site` is staff choosing the website's id; `store` is a store choosing its own.
 */
import type { ApiClient } from './api-client';
import type { Ga4Picker, Ga4Stream } from './contracts/settings';

export function ga4PickerFor(client: ApiClient, kind: 'site' | 'store'): Ga4Picker {
  return {
    available: async () => (await client.call<{ available: boolean }>('/api/google/ga4')).available,
    start: async (opts) => (await client.call<{ authorizeUrl: string }>('/api/google/ga4/start', { body: { for: kind, ...(opts?.create ? { create: true } : {}) } })).authorizeUrl,
    streams: async (ticket) => (await client.call<{ streams: Ga4Stream[] }>('/api/google/ga4/streams', { body: { for: kind, ticket } })).streams,
  };
}

/** Where there is no server (the static preview): no Google sign-in; the id is pasted. */
export const noGa4Picker: Ga4Picker = {
  available: async () => false,
  start: async () => { throw new Error('not available here'); },
  streams: async () => [],
};
