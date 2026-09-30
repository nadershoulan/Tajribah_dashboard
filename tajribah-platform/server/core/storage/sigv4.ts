/**
 * AWS Signature V4 query presigning, on WebCrypto (T4 — no SDK).
 *
 * R2 speaks the S3 API, so a presigned PUT lets the browser upload a 3D model straight to
 * the bucket: the bytes never pass through a Worker, which has a request-size limit far
 * below a textured GLB. The URL is short-lived and names one exact key, so it grants
 * nothing beyond "write this one object, for the next few minutes".
 *
 * Checked against the worked example in the AWS documentation ("Authenticating Requests:
 * Using Query Parameters") in `__tests__/storage.test.ts`.
 */
const encoder = new TextEncoder();

async function hmacRaw(key: Uint8Array<ArrayBuffer>, message: string): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message)));
}

async function sha256Hex(message: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(message))));
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** RFC 3986 encoding, which is what SigV4 canonicalises with — stricter than encodeURIComponent. */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export type PresignInput = {
  method: 'GET' | 'PUT';
  host: string;
  /** Unencoded path, starting with `/`. Each segment is encoded here. */
  path: string;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds: number;
  now?: Date;
  /**
   * Extra headers the client must send exactly, lower-case names. Signing `content-type`
   * makes the upload fail unless the browser declares the type we agreed to.
   */
  headers?: Record<string, string>;
  /** http only for an S3 server on this machine (MinIO in the local run); https everywhere else. */
  protocol?: 'https' | 'http';
};

export async function presignUrl(input: PresignInput): Promise<string> {
  const service = input.service ?? 's3';
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;

  const headers: Record<string, string> = { host: input.host, ...(input.headers ?? {}) };
  const headerNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const signedHeaders = headerNames.join(';');
  const canonicalHeaders = headerNames.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${input.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(input.expiresInSeconds),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query).sort()
    .map((name) => `${rfc3986(name)}=${rfc3986(query[name])}`)
    .join('&');

  const canonicalUri = input.path.split('/').map(rfc3986).join('/');
  const canonicalRequest = [
    input.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');

  let signingKey = await hmacRaw(encoder.encode(`AWS4${input.secretAccessKey}`), dateStamp);
  for (const part of [input.region, service, 'aws4_request']) signingKey = await hmacRaw(signingKey, part);
  const signature = hex(await hmacRaw(signingKey, stringToSign));

  return `${input.protocol ?? 'https'}://${input.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export type SignInput = {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  url: URL;
  region: string;
  service?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Headers to send and sign besides host, x-amz-date and x-amz-content-sha256 (lower-case names). */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body, or UNSIGNED-PAYLOAD (allowed by S3 and R2). */
  payloadHash?: string;
  now?: Date;
};

/**
 * P7 / T57 — a request signed in its headers (Authorization), for the S3 API itself: the Node worker
 * reaches R2 through it, having no Workers binding. Same canonical form as `presignUrl`; checked
 * against the AWS documentation's "GET Object" example and against a real S3 server (MinIO).
 */
export async function signRequest(input: SignInput): Promise<Record<string, string>> {
  const service = input.service ?? 's3';
  const now = input.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/${service}/aws4_request`;
  const payloadHash = input.payloadHash ?? 'UNSIGNED-PAYLOAD';

  const headers: Record<string, string> = { ...(input.headers ?? {}), host: input.url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const signedHeaders = names.join(';');
  const canonicalHeaders = names.map((name) => `${name}:${String(headers[name]).trim()}\n`).join('');
  const params = [...input.url.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)] as const).sort(([a, x], [b, y]) => (a < b ? -1 : a > b ? 1 : x < y ? -1 : x > y ? 1 : 0));
  const canonicalQuery = params.map(([k, v]) => `${k}=${v}`).join('&');
  const canonicalUri = decodeURIComponent(input.url.pathname).split('/').map(rfc3986).join('/');
  const canonicalRequest = [input.method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
  let signingKey = await hmacRaw(encoder.encode(`AWS4${input.secretAccessKey}`), dateStamp);
  for (const part of [input.region, service, 'aws4_request']) signingKey = await hmacRaw(signingKey, part);
  const signature = hex(await hmacRaw(signingKey, stringToSign));
  const { host: _host, ...sent } = headers;
  void _host;
  return { ...sent, authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` };
}
