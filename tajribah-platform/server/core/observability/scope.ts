/**
 * P0.18 — the request scope: which request (or job) the current code is running for.
 *
 * `AsyncLocalStorage` carries it through every `await`, timer and `Promise.all` below the
 * entry point, so the logger can stamp `requestId` / `tenantId` / `userId` on every line
 * without each call site passing them. On Workers this needs `nodejs_compat`, which
 * vite.config.ts sets.
 *
 * Kept free of other imports so the logger can depend on it without a cycle.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type Scope = {
  requestId: string;
  tenantId?: string | null;
  userId?: string;
  jobId?: string;
};

const storage = new AsyncLocalStorage<Scope>();

export function runInScope<T>(scope: Scope, fn: () => T): T {
  return storage.run({ ...scope }, fn);
}

export function currentScope(): Scope | undefined {
  return storage.getStore();
}

/**
 * Record who the request turned out to be for, once auth has resolved it. Every log line
 * after this carries the tenant and user; lines before it (auth itself) carry only the id.
 */
export function bindActor(actor: { tenantId?: string | null; userId?: string }): void {
  const scope = storage.getStore();
  if (!scope) return;
  if (actor.tenantId !== undefined) scope.tenantId = actor.tenantId;
  if (actor.userId !== undefined) scope.userId = actor.userId;
}
