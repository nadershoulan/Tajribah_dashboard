/**
 * P0.2 — `.env.example`, rendered from the env registry.
 *
 * §13.6: a hand-kept template drifts — a variable is added to the code and never to the
 * example, and the next deploy fails on a name nobody knew existed. So the template is
 * rendered from `REGISTRY`, written by `scripts/gen-env-example.mjs`, and a test fails when
 * the committed file differs from what the registry renders now.
 */
import { z } from 'zod';
import { REGISTRY } from './env';

type Entry = (typeof REGISTRY)[keyof typeof REGISTRY];

/** The zod default, if the schema has one (unwrapping `.optional()` / `.default()` layers). */
function defaultOf(schema: z.ZodTypeAny): unknown {
  let current: z.ZodTypeAny = schema;
  for (let depth = 0; depth < 5; depth++) {
    if (current instanceof z.ZodDefault) return current._def.defaultValue();
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) { current = current._def.innerType; continue; }
    if (current instanceof z.ZodEffects) { current = current._def.schema; continue; }
    return undefined;
  }
  return undefined;
}

export function renderEnvExample(registry: Record<string, Entry> = REGISTRY): string {
  const lines = [
    '# Tajribah platform — environment template.',
    '#',
    '# GENERATED from server/core/config/env.ts by `node scripts/gen-env-example.mjs`.',
    '# Do not edit by hand: change the registry and regenerate. A test fails when they differ.',
    '#',
    '# [required]  boot fails without it.',
    '# [secret]    never commit a real value; set it in the secret store for each environment.',
    '# Conditional requirements (e.g. RESEND_API_KEY when EMAIL_PROVIDER=resend) are in the notes.',
  ];

  const scopes = [...new Set(Object.values(registry).map((e) => e.scope))];
  for (const scope of scopes) {
    lines.push('', `# ── ${scope} ${'─'.repeat(Math.max(0, 76 - scope.length))}`);
    for (const [name, entry] of Object.entries(registry)) {
      if (entry.scope !== scope) continue;
      const fallback = defaultOf(entry.schema);
      const required = !entry.schema.isOptional() && fallback === undefined;
      const tags = [required ? '[required]' : '', 'secret' in entry && entry.secret ? '[secret]' : ''].filter(Boolean).join(' ');
      const note = fallback === undefined ? '' : ` (default: ${String(fallback)})`;
      lines.push('', `# ${tags ? `${tags} ` : ''}${entry.doc}${note}`);
      const value = 'example' in entry && entry.example !== undefined ? entry.example : fallback === undefined ? '' : String(fallback);
      // Quote anything a shell would split or treat as a comment when the file is sourced.
      lines.push(`${name}=${/[\s#"'<>]/.test(value) ? JSON.stringify(value) : value}`);
    }
  }
  return `${lines.join('\n')}\n`;
}
