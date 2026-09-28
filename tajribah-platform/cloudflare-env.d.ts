declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    /** P1.15: published viewer configs (`server/core/edge/configs.ts`), read by the `cfg.` Worker. */
    CONFIGS?: KVNamespace;
  }
}
