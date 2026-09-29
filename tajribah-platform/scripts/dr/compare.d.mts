/** Types for `compare.mjs` (plain JavaScript, so `drill.mjs` runs on Node with no build step). */
export type TableFacts = { rows: number; rls: boolean; forced: boolean };
export type DatabaseFacts = { schema: string; policies: number; tables: Record<string, TableFacts> };
export type RestoredFacts = DatabaseFacts & { crossTenantRows: number; ownRows: number };
export function compareRestore(manifest: DatabaseFacts, restored: RestoredFacts): { ok: boolean; problems: string[] };
