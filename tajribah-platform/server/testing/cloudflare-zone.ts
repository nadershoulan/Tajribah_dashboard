/**
 * T62 — a stand-in for one Cloudflare zone's custom-hostname API (Cloudflare for SaaS), answering as
 * Cloudflare's public documentation shows (read 2026-10-01) and, for a refused token, as the real API
 * was seen to answer that day:
 *
 *  - `POST /zones/{zone}/custom_hostnames` → 201 `{ success, result: { id, hostname, status: 'pending',
 *    ssl: { status: 'pending_validation', method, type }, verification_errors } }`; the same hostname
 *    again → 409 (code 1406);
 *  - `GET …/{id}` → the hostname, or 404 (code 1436); `GET …?hostname=` → a list;
 *  - `DELETE …/{id}` → 200, or 404;
 *  - a token it does not know → 400 `{ success: false, errors: [{ code: 9106, … }] }` (the real answer);
 *  - 503 while down.
 * A test moves a hostname on with `validate(hostname)` — Cloudflare's own checks passing. Tests only.
 */
import { CLOUDFLARE_API } from '@/server/core/edge/custom-hostnames';

export const CF_ZONE = '023e105f4ecef8ad9ca31a8372d0c353';
export const CF_TOKEN = 'cf-test-token';

type Hostname = { id: string; hostname: string; status: string; ssl: { status: string; method: string; type: string }; verification_errors?: string[] };

export class CloudflareZone {
  readonly hostnames = new Map<string, Hostname>();
  readonly calls: string[] = [];
  down = false;
  private made = 0;

  /** Cloudflare's checks pass: the hostname and its certificate are active. */
  validate(hostname: string): void {
    const h = [...this.hostnames.values()].find((x) => x.hostname === hostname);
    if (!h) throw new Error(`no custom hostname ${hostname}`);
    h.status = 'active'; h.ssl.status = 'active'; delete h.verification_errors;
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    this.calls.push(`${method} ${url.pathname.replace(`/client/v4/zones/${CF_ZONE}`, '')}${url.search}`);
    if (this.down) return new Response('Service Unavailable', { status: 503 });
    const fail = (status: number, code: number, message: string) => Response.json({ success: false, errors: [{ code, message }], messages: [], result: null }, { status });
    if (new Headers(init?.headers).get('authorization') !== `Bearer ${CF_TOKEN}`) return fail(400, 9106, 'Authentication failed (status: 400)');
    const base = `${new URL(CLOUDFLARE_API).pathname}/zones/${CF_ZONE}/custom_hostnames`;
    if (!url.pathname.startsWith(base)) return fail(404, 7003, 'Could not route to the requested resource');
    const id = url.pathname.slice(base.length + 1);
    const ok = (result: unknown, status = 200) => Response.json({ success: true, errors: [], messages: [], result }, { status });

    if (!id && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as { hostname: string; ssl?: { method?: string; type?: string } };
      if ([...this.hostnames.values()].some((h) => h.hostname === body.hostname)) return fail(409, 1406, 'Duplicate custom hostname found.');
      this.made += 1;
      const h: Hostname = {
        id: `0d89c70d-ad9f-4843-b99f-${String(this.made).padStart(12, '0')}`, hostname: body.hostname, status: 'pending',
        ssl: { status: 'pending_validation', method: body.ssl?.method ?? 'http', type: body.ssl?.type ?? 'dv' },
        verification_errors: ['None of the A or AAAA records are owned by this account and the pre-generated ownership verification token was not found.'],
      };
      this.hostnames.set(h.id, h);
      return ok(h, 201);
    }
    if (!id && method === 'GET') {
      const wanted = url.searchParams.get('hostname');
      return ok([...this.hostnames.values()].filter((h) => !wanted || h.hostname === wanted));
    }
    const found = this.hostnames.get(id);
    if (!found) return fail(404, 1436, 'The custom hostname was not found.');
    if (method === 'GET') return ok(found);
    if (method === 'DELETE') { this.hostnames.delete(id); return ok({ id }); }
    return fail(405, 7001, 'Method not allowed for this endpoint');
  }) as typeof fetch;
}
