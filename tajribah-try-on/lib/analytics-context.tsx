'use client';

/**
 * T69 — the website's live GA4 measurement id, from the root layout (`lib/site-settings.ts`) to the
 * consent banner, the footer link and the policy pages. Without a provider (the static preview) it is
 * the build's id, if any.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { ENV_GA_ID } from './analytics';

const GaId = createContext<string | null>(ENV_GA_ID);

export function AnalyticsProvider({ id, children }: { id: string | null; children: ReactNode }) {
  return <GaId.Provider value={id}>{children}</GaId.Provider>;
}

export const useGaId = (): string | null => useContext(GaId);
