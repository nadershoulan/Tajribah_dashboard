/**
 * The Worker entry glue: the only file that imports the Workers runtime.
 *
 * Every `app/api/**` route wraps its handler in `withBoot`, so configuration is validated
 * and adapters are installed before the first request of an isolate is handled. A broken
 * environment answers every request with a 500 problem document and logs why — it does not
 * half-start.
 */
import { env } from 'cloudflare:workers';
import { bootstrap } from '@/server/core/http/bootstrap';
import { problemResponse } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';

let booted = false;

/** Validate the environment and install the adapters, once per isolate. Throws what is wrong. */
export function bootOnce(): void {
  if (booted) return;
  bootstrap(env as unknown as Record<string, unknown>, typeof process !== 'undefined' ? process.env : {});
  booted = true;
}

export function withBoot(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    if (!booted) {
      try {
        bootOnce();
      } catch (error) {
        log.error('boot failed', { error: error instanceof Error ? error.message : String(error) });
        return problemResponse(error);
      }
    }
    return handler(request);
  };
}
