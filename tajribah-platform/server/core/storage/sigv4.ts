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

  return `https://${input.host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
