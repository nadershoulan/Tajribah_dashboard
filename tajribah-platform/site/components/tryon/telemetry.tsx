'use client';

/**
 * T140.5 — where the try-on's anonymous counts go: the store and product it is for (set by the shop's try-on window,
 * the product's own page and the QR phone page). Nothing provided (the demo, the dashboard's preview): nothing is sent.
 */
import { createContext, useContext } from 'react';
import type { Telemetry } from '@site/lib/tryon-telemetry';

export const TelemetryContext = createContext<Telemetry | null>(null);
export const useTelemetry = () => useContext(TelemetryContext);
