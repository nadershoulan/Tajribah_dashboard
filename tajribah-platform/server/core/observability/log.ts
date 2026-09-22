/**
 * P0.18 — structured logging.
 *
 * One line of JSON per event, always carrying the request id and the tenant id when there
 * is one. §13.4's "done means I ran it" has a companion here: when something goes wrong in
 * production, the only evidence is what this wrote.
 *
 * Never log: passwords, tokens, provider secrets, OTP codes, full request bodies, raw IPs
 * or raw user agents. `redact()` is applied to every field, so a slip is caught rather than
 * shipped.
 */
import { currentScope } from './scope';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogContext = {
  requestId?: string;
  tenantId?: string | null;
  userId?: string;
  [key: string]: unknown;
};

const SENSITIVE = /(password|secret|token|authorization|cookie|otp|key_hash|api_key|credential)/i;

export function redact(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SENSITIVE.test(key)) { out[key] = '[redacted]'; continue; }
    out[key] = value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
      ? redact(value as Record<string, unknown>)
      : value;
  }
  return out;
}

let minimum: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  minimum = level;
}

function emit(level: LogLevel, message: string, context: LogContext = {}): void {
  if (ORDER[level] < ORDER[minimum]) return;
  // The request scope first, so an explicit field at the call site still wins.
  const scope = currentScope();
  const line = JSON.stringify({
    level, message, at: new Date().toISOString(),
    ...(scope ? redact(Object.fromEntries(Object.entries(scope).filter(([, v]) => v !== undefined))) : {}),
    ...redact(context),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (message: string, context?: LogContext) => emit('debug', message, context),
  info: (message: string, context?: LogContext) => emit('info', message, context),
  warn: (message: string, context?: LogContext) => emit('warn', message, context),
  error: (message: string, context?: LogContext) => emit('error', message, context),
  /** A logger bound to a request or job, so the ids do not have to be repeated. */
  with(base: LogContext) {
    return {
      debug: (m: string, c?: LogContext) => emit('debug', m, { ...base, ...c }),
      info: (m: string, c?: LogContext) => emit('info', m, { ...base, ...c }),
      warn: (m: string, c?: LogContext) => emit('warn', m, { ...base, ...c }),
      error: (m: string, c?: LogContext) => emit('error', m, { ...base, ...c }),
    };
  },
};
