/**
 * P1.15 — where published viewer configs live: the store the shop's widget and the try-on page
 * read, at `{store key}/{product ref}.json` (`widget/src/main.ts` `configUrl` adds the host).
 *
 * The shopper's path never reads Postgres. In production this is a Cloudflare KV namespace bound
 * to the Worker as `CONFIGS` (`CONFIG_STORE=kv`); the config host (`host.ts`) answers from it.
 * Locally and in tests it is memory. Every write goes through `ConfigStore`, so the choice of
 * backend stays behind one interface (DECISIONS P1.15).
 */

/** The part of Workers' `KVNamespace` used here — a structural type, so tests need no runtime. */
export type KvBinding = {
  get(key: string, type: 'text'): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: Record<string, unknown> }): Promise<void>;
  delete(key: string): Promise<void>;
};

export interface ConfigStore {
  get(key: string): Promise<string | null>;
  put(key: string, body: string, version: number): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryConfigStore implements ConfigStore {
  readonly entries = new Map<string, { body: string; version: number }>();
  async get(key: string) { return this.entries.get(key)?.body ?? null; }
  async put(key: string, body: string, version: number) { this.entries.set(key, { body, version }); }
  async delete(key: string) { this.entries.delete(key); }
}

export class KvConfigStore implements ConfigStore {
  constructor(private readonly kv: KvBinding) {}
  async get(key: string) { return this.kv.get(key, 'text'); }
  async put(key: string, body: string, version: number) { await this.kv.put(key, body, { metadata: { version } }); }
  async delete(key: string) { await this.kv.delete(key); }
}

/** The part of `Storage` (server/core/storage) used here: a structural type, so configs need not import storage. */
export type ObjectStore = {
  put(key: string, body: string, options?: { contentType?: string }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream } | null>;
  delete(key: string): Promise<void>;
};

/**
 * T75 — on this computer only: published configs kept in the local storage (an S3 server such as
 * SeaweedFS) under `edge-configs/`, so they survive a restart of the dashboard. Memory forgot them, and
 * the dashboard then showed a product as published that its page could not find.
 */
export class LocalStorageConfigStore implements ConfigStore {
  constructor(private readonly objects: ObjectStore, private readonly prefix = 'edge-configs/') {}
  async get(key: string) {
    const found = await this.objects.get(this.prefix + key);
    return found ? new Response(found.body).text() : null;
  }
  async put(key: string, body: string) { await this.objects.put(this.prefix + key, body, { contentType: 'application/json' }); }
  async delete(key: string) { await this.objects.delete(this.prefix + key); }
}

/** Storage on this computer: an S3 endpoint at localhost, 127.0.0.1 or (T82) its Wi-Fi address. */
export const isLocalStorage = (config: { STORAGE_PROVIDER?: string; S3_ENDPOINT?: string }): boolean =>
  config.STORAGE_PROVIDER === 's3' && /^http:\/\/(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?(?:\/|$)/.test(config.S3_ENDPOINT ?? '');

let current: ConfigStore = new MemoryConfigStore();
export function setConfigStore(store: ConfigStore): void { current = store; }
export function configStore(): ConfigStore { return current; }

/** Install the store the environment names; `loadEnv()` has already refused memory in production. */
export function configureConfigStore(config: { CONFIG_STORE?: 'memory' | 'kv'; STORAGE_PROVIDER?: string; S3_ENDPOINT?: string }, kv?: KvBinding, objects?: ObjectStore): void {
  if (config.CONFIG_STORE !== 'kv') { current = objects && isLocalStorage(config) ? new LocalStorageConfigStore(objects) : new MemoryConfigStore(); return; }
  if (!kv) throw new Error('CONFIG_STORE=kv but no KV namespace binding (CONFIGS) is bound to this Worker');
  current = new KvConfigStore(kv);
}

/**
 * The key for one product's config: the two segments exactly as the widget encodes them in the URL
 * (`encodeURIComponent`), so a platform's product id with a slash or a colon cannot reach another
 * key. The config host decodes what it receives and calls this again — one spelling per product.
 */
export function configKey(store: string, productRef: string): string {
  for (const part of [store, productRef]) {
    if (!part || part.length > 200) throw new Error(`not a config key segment: "${part}"`);
  }
  return `${encodeURIComponent(store)}/${encodeURIComponent(productRef)}.json`;
}
