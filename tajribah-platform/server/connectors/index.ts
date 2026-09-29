/**
 * Every store connector the platform runs, registered in one place — by the web app at boot and by
 * the worker before its first tick (the sync jobs run there). WooCommerce first (P6): it needs no
 * partner account. Salla, Zid and Shopify join here when their apps exist.
 */
import { registerConnector } from './types';
import { WooCommerceConnector } from './woocommerce/connector';

export function registerAllConnectors(): void {
  registerConnector(new WooCommerceConnector());
}
