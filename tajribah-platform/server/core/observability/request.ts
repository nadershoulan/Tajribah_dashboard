/**
 * P0.18 — the one wrapper every route handler goes through.
 *
 *  - gives the request an id (a well-formed incoming `x-request-id` from our own edge is
 *    kept, anything else is replaced) and returns it as `x-request-id`;
 *  - runs the handler inside the request scope, so every log line it produces — however
 *    deep, however async — carries that id;
 *  - writes one access line per request (method, path, status, duration, its SLO budget), and a
 *    `slow request` warning when it took longer than the budget (P7, `slo.ts`);
 *  - is the error hook: a thrown `AppError` becomes its problem+json, anything else
 *    becomes a 500 whose detail stays in the log, never in the response.
 */
import { uuidv7 } from '@/lib/ids';
import { langFromCookie } from '@/lib/lang';
import { isAppError, problemResponse } from '../errors/problem';
import { log } from './log';
import { currentScope, runInScope } from './scope';
import { budgetMs } from './slo';
import { withDbConnection } from '../../../db/client';

export const REQUEST_ID_HEADER = 'x-request-id';

/** An incoming id is echoed only if it looks like one: it lands in logs, so it is never free text. */
export function requestIdFrom(headers: Headers): string {
  const incoming = headers.get(REQUEST_ID_HEADER);
  return incoming && /^[A-Za-z0-9_-]{8,64}$/.test(incoming) ? incoming : uuidv7();
}

export type RouteHandler = (request: Request) => Promise<Response>;

export function route(handler: RouteHandler): RouteHandler {
  return (request) => {
    const requestId = requestIdFrom(request.headers);
    return runInScope({ requestId }, async () => {
      const started = Date.now();
      const path = new URL(request.url).pathname;
      let response: Response;
      try {
        response = await withDbConnection(() => handler(request)); // P0.20: this request's connections
      } catch (error) {
        if (!isAppError(error) || error.code === 'internal') {
          log.error('unhandled error', {
            path,
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
        }
        response = problemResponse(error, {
          requestId, instance: path, lang: langFromCookie(request.headers.get('cookie')),
        });
      }

      // Responses from fetch() have immutable headers; copy before stamping the id.
      const stamped = new Response(response.body, response);
      stamped.headers.set(REQUEST_ID_HEADER, requestId);
      const ms = Date.now() - started;
      const budget = budgetMs(request.method, path);
      log.info('request', {
        method: request.method, path, status: stamped.status, ms, budgetMs: budget,
        tenantId: currentScope()?.tenantId,
      });
      if (ms > budget) log.warn('slow request', { method: request.method, path, status: stamped.status, ms, budgetMs: budget });
      return stamped;
    });
  };
}
