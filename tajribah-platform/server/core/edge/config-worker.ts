/**
 * P1.15 — the Worker behind `cfg.tajribah.org`: the config host (`host.ts`) over the `CONFIGS` KV
 * namespace. Deployed on its own once the Cloudflare account exists, so a busy dashboard or a
 * database incident never touches the shopper's path.
 */
import { serveConfig } from './host';
import { KvConfigStore, type KvBinding } from './configs';

const configHost = {
  fetch(request: Request, env: { CONFIGS: KvBinding }): Promise<Response> {
    return serveConfig(request, new KvConfigStore(env.CONFIGS));
  },
};

export default configHost;
