/**
 * P0.14 — object storage behind an interface (D4).
 *
 * Keys are tenant-scoped by construction: `key()` is the only way to build one, and it
 * always starts `t/{tenantId}/`. A key without a tenant prefix is a cross-tenant read
 * waiting for a guessed id, and listing is prefix-based, so the prefix *is* the boundary.
 *
 * The column that stores one of these is `storage_key`, never `r2_key` — the plan is
 * explicit that the provider must be swappable, and a column name outlives an adapter.
 *
 * Services reach storage through `forTenant(tenantId)`, which refuses any key outside that
 * tenant's prefix — a key read from a request body is a claim, not a fact.
 */
import type { Env } from '../config/env';
import { errors } from '../errors/problem';
import { presignUrl, signRequest } from './sigv4';
export type StoredObject = {
  key: string;
  size: number;
  contentType: string | null;
  checksum: string | null;
  uploadedAt: Date;
};

export interface Storage {
  put(key: string, body: ArrayBuffer | ReadableStream | string, options?: {
    contentType?: string;
    /** Models and textures are immutable and versioned; everything else is not. */
    immutable?: boolean;
  }): Promise<StoredObject>;
  get(key: string): Promise<{ body: ReadableStream; meta: StoredObject } | null>;
  head(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  list(prefix: string, limit?: number): Promise<StoredObject[]>;
  /** A short-lived URL the browser can upload to directly, so bytes never pass through us. */
  presignUpload(key: string, options?: { contentType?: string; expiresInSeconds?: number }): Promise<{ url: string; expiresAt: Date }>;
  /** The public CDN URL for an object that is meant to be public (models, images). */
  publicUrl(key: string): string;
}

export type AssetKind = 'model' | 'texture' | 'thumbnail' | 'photo' | 'invoice' | 'export';

/**
 * The only way to build a storage key.
 *
 * `version` is part of the path rather than a query string so the CDN can cache forever:
 * a new version is a new URL, which is why nothing ever needs a cache purge.
 */
export function key(input: {
  tenantId: string;
  kind: AssetKind;
  id: string;
  filename: string;
  version?: number;
}): string {
  for (const part of [input.tenantId, input.id]) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(part)) throw new Error(`unsafe storage key segment "${part}"`);
  }
  // Dots are kept for the extension, but never two in a row: `..` must not reach a path.
  const safe = input.filename.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/\.{2,}/g, '.').replace(/^\./, '_').slice(-80);
  const version = input.version === undefined ? '' : `v${input.version}/`;
  return `t/${input.tenantId}/${input.kind}/${input.id}/${version}${safe}`;
}

/** True when `key` belongs to `tenantId`. Checked before every read that takes a key from a request. */
export function keyBelongsTo(storageKey: string, tenantId: string): boolean {
  // `t/A/../B/x` starts with A's prefix, and a CDN or browser normalises it into B's.
  if (/(^|\/)\.\.?(\/|$)|\/\/|\\/.test(storageKey)) return false;
  return !!tenantId && storageKey.startsWith(`t/${tenantId}/`);
}

export function tenantPrefix(tenantId: string, kind?: AssetKind): string {
  return kind ? `t/${tenantId}/${kind}/` : `t/${tenantId}/`;
}

/** R2's S3 API credentials — needed only to presign; everything else uses the binding. */
export type R2S3Credentials = {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** A presigned upload is valid for at most an hour, whatever the caller asks for. */
export const MAX_PRESIGN_SECONDS = 3600;

/** Cloudflare R2 through the Workers binding. */
export class R2Storage implements Storage {
  constructor(
    private readonly bucket: R2Bucket,
    private readonly cdnBaseUrl: string,
    private readonly s3?: R2S3Credentials,
  ) {}

  async put(k: string, body: ArrayBuffer | ReadableStream | string, options: { contentType?: string; immutable?: boolean } = {}) {
    const result = await this.bucket.put(k, body as never, {
      httpMetadata: {
        contentType: options.contentType,
        cacheControl: options.immutable ? 'public, max-age=31536000, immutable' : 'private, max-age=0',
      },
    });
    return {
      key: k,
      size: result?.size ?? 0,
      contentType: options.contentType ?? null,
      checksum: result?.etag ?? null,
      uploadedAt: result?.uploaded ?? new Date(),
    };
  }

  async get(k: string) {
    const object = await this.bucket.get(k);
    if (!object) return null;
    return {
      body: object.body as ReadableStream,
      meta: {
        key: k,
        size: object.size,
        contentType: object.httpMetadata?.contentType ?? null,
        checksum: object.etag,
        uploadedAt: object.uploaded,
      },
    };
  }

  async head(k: string) {
    const object = await this.bucket.head(k);
    if (!object) return null;
    return {
      key: k,
      size: object.size,
      contentType: object.httpMetadata?.contentType ?? null,
      checksum: object.etag,
      uploadedAt: object.uploaded,
    };
  }

  async delete(k: string) {
    await this.bucket.delete(k);
  }

  async list(prefix: string, limit = 100) {
    const listed = await this.bucket.list({ prefix, limit });
    return listed.objects.map((object) => ({
      key: object.key,
      size: object.size,
      contentType: object.httpMetadata?.contentType ?? null,
      checksum: object.etag,
      uploadedAt: object.uploaded,
    }));
  }

  async presignUpload(k: string, options: { contentType?: string; expiresInSeconds?: number } = {}) {
    // The S3 credentials arrive with the Cloudflare account (§12.2). Without them, uploads
    // go through a Worker route that streams to `put`.
    if (!this.s3) throw new Error('presignUpload needs R2 S3 credentials (R2_ACCESS_KEY_ID …) — not configured');
    const expires = Math.min(options.expiresInSeconds ?? 900, MAX_PRESIGN_SECONDS);
    const now = new Date();
    const url = await presignUrl({
      method: 'PUT',
      host: `${this.s3.accountId}.r2.cloudflarestorage.com`,
      path: `/${this.s3.bucketName}/${k}`,
      region: 'auto',
      accessKeyId: this.s3.accessKeyId,
      secretAccessKey: this.s3.secretAccessKey,
      expiresInSeconds: expires,
      now,
      headers: options.contentType ? { 'content-type': options.contentType } : undefined,
    });
    return { url, expiresAt: new Date(now.getTime() + expires * 1000) };
  }

  publicUrl(k: string): string {
    return `${this.cdnBaseUrl.replace(/\/$/, '')}/${k}`;
  }
}

/**
 * P7 / T57 — any S3-compatible bucket through the S3 API itself: Cloudflare R2's S3 endpoint for the
 * Node worker (it has no Workers binding, and runs the image and model jobs), or MinIO on this machine.
 * Path-style addresses (`{endpoint}/{bucket}/{key}`), each request signed (SigV4). A streamed body is
 * read whole first: S3 needs its length, and these files are a few megabytes.
 */
export type S3Config = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; cdnBaseUrl: string };

export class S3Storage implements Storage {
  private readonly base: URL;
  constructor(private readonly config: S3Config, private readonly fetchImpl: typeof fetch = (...a) => fetch(...a)) {
    this.base = new URL(config.endpoint.replace(/\/+$/, ''));
  }

  private url(k = '', query: Record<string, string> = {}): URL {
    const url = new URL(`${this.base.origin}${this.base.pathname.replace(/\/$/, '')}/${this.config.bucket}${k ? `/${k.split('/').map(encodeURIComponent).join('/')}` : ''}`);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url;
  }

  private async send(method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', url: URL, headers: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const signed = await signRequest({ method, url, region: this.config.region, accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey, headers });
    const response = await this.fetchImpl(url.toString(), { method, headers: signed, ...(body ? { body: body as unknown as BodyInit } : {}) });
    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => '');
      throw new Error(`storage ${method} ${url.pathname}: ${response.status} ${/<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? ''}`.trim());
    }
    return response;
  }

  private meta(k: string, response: Response): StoredObject {
    return {
      key: k, size: Number(response.headers.get('content-length') ?? 0), contentType: response.headers.get('content-type'),
      checksum: response.headers.get('etag')?.replace(/"/g, '') ?? null, uploadedAt: new Date(response.headers.get('last-modified') ?? Date.now()),
    };
  }

  async put(k: string, body: ArrayBuffer | ReadableStream | string, options: { contentType?: string; immutable?: boolean } = {}) {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body instanceof ArrayBuffer ? new Uint8Array(body) : await drain(body);
    const response = await this.send('PUT', this.url(k), {
      ...(options.contentType ? { 'content-type': options.contentType } : {}),
      'cache-control': options.immutable ? 'public, max-age=31536000, immutable' : 'private, max-age=0',
    }, bytes);
    await response.body?.cancel();
    return { key: k, size: bytes.byteLength, contentType: options.contentType ?? null, checksum: response.headers.get('etag')?.replace(/"/g, '') ?? null, uploadedAt: new Date() };
  }

  async get(k: string) {
    const response = await this.send('GET', this.url(k));
    if (response.status === 404 || !response.body) { await response.body?.cancel(); return null; }
    return { body: response.body, meta: this.meta(k, response) };
  }

  async head(k: string) {
    const response = await this.send('HEAD', this.url(k));
    return response.status === 404 ? null : this.meta(k, response);
  }

  async delete(k: string) {
    const response = await this.send('DELETE', this.url(k));
    await response.body?.cancel();
  }

  async list(prefix: string, limit = 100) {
    const response = await this.send('GET', this.url('', { 'list-type': '2', prefix, 'max-keys': String(limit) }));
    const xml = await response.text();
    const field = (block: string, name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1] ?? '';
    const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
    return [...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map(([, block]) => ({
      key: unescape(field(block!, 'Key')), size: Number(field(block!, 'Size')), contentType: null,
      checksum: unescape(field(block!, 'ETag')).replace(/"/g, '') || null, uploadedAt: new Date(field(block!, 'LastModified')),
    }));
  }

  async presignUpload(k: string, options: { contentType?: string; expiresInSeconds?: number } = {}) {
    const expires = Math.min(options.expiresInSeconds ?? 900, MAX_PRESIGN_SECONDS);
    const now = new Date();
    const url = await presignUrl({
      method: 'PUT', host: this.base.host, path: `${this.base.pathname.replace(/\/$/, '')}/${this.config.bucket}/${k}`, region: this.config.region,
      accessKeyId: this.config.accessKeyId, secretAccessKey: this.config.secretAccessKey, expiresInSeconds: expires, now,
      headers: options.contentType ? { 'content-type': options.contentType } : undefined,
      protocol: this.base.protocol === 'http:' ? 'http' : 'https',
    });
    return { url, expiresAt: new Date(now.getTime() + expires * 1000) };
  }

  publicUrl(k: string): string {
    return `${this.config.cdnBaseUrl.replace(/\/$/, '')}/${k}`;
  }
}

/** In-memory, for tests and for local work before the Cloudflare account exists. */
export class MemoryStorage implements Storage {
  private readonly objects = new Map<string, { data: Uint8Array; meta: StoredObject }>();

  async put(k: string, body: ArrayBuffer | ReadableStream | string, options: { contentType?: string } = {}) {
    const data = typeof body === 'string'
      ? new TextEncoder().encode(body)
      : body instanceof ArrayBuffer ? new Uint8Array(body) : await drain(body);
    const meta: StoredObject = {
      key: k, size: data.byteLength, contentType: options.contentType ?? null,
      checksum: null, uploadedAt: new Date(),
    };
    this.objects.set(k, { data, meta });
    return meta;
  }

  async get(k: string) {
    const found = this.objects.get(k);
    if (!found) return null;
    const bytes = found.data;
    return {
      body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
      meta: found.meta,
    };
  }

  async head(k: string) { return this.objects.get(k)?.meta ?? null; }
  async delete(k: string) { this.objects.delete(k); }

  async list(prefix: string, limit = 100) {
    return [...this.objects.values()]
      .map((o) => o.meta)
      .filter((meta) => meta.key.startsWith(prefix))
      .slice(0, limit);
  }

  async presignUpload(k: string, options: { expiresInSeconds?: number } = {}) {
    return {
      url: `memory://upload/${k}`,
      expiresAt: new Date(Date.now() + (options.expiresInSeconds ?? 900) * 1000),
    };
  }

  publicUrl(k: string): string { return `memory://public/${k}`; }
}

/** Read a stream to the end. The memory adapter used to store streamed uploads as zero bytes. */
async function drain(stream: ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value));
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
  return out;
}

let current: Storage = new MemoryStorage();

export function setStorage(storage: Storage): void { current = storage; }
export function storage(): Storage { return current; }

export type StorageConfig = Pick<Env,
  'STORAGE_PROVIDER' | 'CDN_BASE_URL' | 'R2_ACCOUNT_ID' | 'R2_BUCKET_NAME' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY'> & { S3_ENDPOINT?: string; S3_REGION?: string };

/**
 * Install the adapter the environment names. `bucket` is the Workers binding (`env.BUCKET`);
 * `loadEnv()` has already refused `r2` without a CDN base URL, and memory in production.
 */
export function configureStorage(config: StorageConfig, bucket?: R2Bucket): void {
  if (config.STORAGE_PROVIDER === 's3') {
    // T57: the Node worker, or any runtime without the binding — R2 through its S3 endpoint.
    current = new S3Storage({
      endpoint: config.S3_ENDPOINT ?? `https://${config.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, region: config.S3_REGION ?? 'auto',
      bucket: config.R2_BUCKET_NAME!, accessKeyId: config.R2_ACCESS_KEY_ID!, secretAccessKey: config.R2_SECRET_ACCESS_KEY!, cdnBaseUrl: config.CDN_BASE_URL!,
    });
    return;
  }
  if (config.STORAGE_PROVIDER !== 'r2') { current = new MemoryStorage(); return; }
  if (!bucket) throw new Error('STORAGE_PROVIDER=r2 but no R2 bucket binding (BUCKET) is bound to this Worker');
  const s3 = config.R2_ACCOUNT_ID && config.R2_BUCKET_NAME && config.R2_ACCESS_KEY_ID && config.R2_SECRET_ACCESS_KEY
    ? {
      accountId: config.R2_ACCOUNT_ID, bucketName: config.R2_BUCKET_NAME,
      accessKeyId: config.R2_ACCESS_KEY_ID, secretAccessKey: config.R2_SECRET_ACCESS_KEY,
    }
    : undefined;
  current = new R2Storage(bucket, config.CDN_BASE_URL!, s3);
}

// -------------------------------------------------------------------- tenant scope

/**
 * Storage for one tenant. Every method checks the key against the tenant's prefix first;
 * a foreign or malformed key is a 404, indistinguishable from a missing object.
 */
export class TenantStorage {
  constructor(readonly tenantId: string, private readonly backend: Storage) {}

  /** A key inside this tenant. The only way services should build one. */
  key(input: { kind: AssetKind; id: string; filename: string; version?: number }): string {
    return key({ ...input, tenantId: this.tenantId });
  }

  private own(k: string): string {
    if (!keyBelongsTo(k, this.tenantId)) throw errors.notFound('file');
    return k;
  }

  // Async throughout, so a refused key is always a rejected promise, never a sync throw.
  async put(k: string, body: ArrayBuffer | ReadableStream | string, options?: { contentType?: string; immutable?: boolean }) {
    return this.backend.put(this.own(k), body, options);
  }
  async get(k: string) { return this.backend.get(this.own(k)); }
  async head(k: string) { return this.backend.head(this.own(k)); }
  async delete(k: string) { return this.backend.delete(this.own(k)); }
  /** Lists inside the tenant only; `kind` narrows it further. */
  async list(kind?: AssetKind, limit?: number) { return this.backend.list(tenantPrefix(this.tenantId, kind), limit); }
  async presignUpload(k: string, options?: { contentType?: string; expiresInSeconds?: number }) {
    return this.backend.presignUpload(this.own(k), options);
  }
  /** Sync, because it only builds a string — it still refuses a foreign key by throwing. */
  publicUrl(k: string) { return this.backend.publicUrl(this.own(k)); }
}

export function forTenant(tenantId: string, backend: Storage = current): TenantStorage {
  if (!tenantId) throw new Error('forTenant requires a tenant id');
  return new TenantStorage(tenantId, backend);
}
