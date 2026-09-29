/**
 * Every store connector the platform runs, registered in one place — by the web app at boot and by
 * the worker before its first tick (the sync jobs run there). WooCommerce first (P6): it needs no
 * partner account. Shopify's connector reads a catalogue already; connecting a shop waits for the
 * Shopify app (a Partner account). Salla and Zid join here when their apps exist.
 */
import { registerConnector } from './types';
import { WooCommerceConnector } from './woocommerce/connector';
import { ShopifyConnector } from './shopify/connector';

export function registerAllConnectors(): void {
  registerConnector(new WooCommerceConnector());
  registerConnector(new ShopifyConnector());
}
