/**
 * Every store connector the platform runs, registered in one place — by the web app at boot and by
 * the worker before its first tick (the sync jobs run there). WooCommerce first (P6): it needs no
 * partner account. Shopify's and Salla's connectors read a catalogue already; connecting a store
 * waits for each platform's app (a Partner account). Zid joins here next.
 */
import { loadEnv } from '../core/config/env';
import { registerConnector } from './types';
import { WooCommerceConnector } from './woocommerce/connector';
import { ShopifyConnector } from './shopify/connector';
import { SallaConnector, type SallaApp } from './salla/connector';

/** The Salla Partner app's keys, or null until it is registered (P1.4). */
export function sallaApp(): SallaApp | null {
  const env = loadEnv();
  return env.SALLA_CLIENT_ID && env.SALLA_CLIENT_SECRET ? { clientId: env.SALLA_CLIENT_ID, clientSecret: env.SALLA_CLIENT_SECRET } : null;
}

export function registerAllConnectors(): void {
  registerConnector(new WooCommerceConnector());
  registerConnector(new ShopifyConnector());
  registerConnector(new SallaConnector(sallaApp));
}
