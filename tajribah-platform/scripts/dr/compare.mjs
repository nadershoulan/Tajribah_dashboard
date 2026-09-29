/**
 * P7 — disaster recovery: the pure half of the restore check. Given what the backup recorded (its
 * manifest) and what the restored copy holds, say what is wrong — nothing, when the restore is
 * whole. Free of any database, so it runs in the test suite on every change; `drill.mjs` gathers
 * the facts from real Postgres and calls it.
 *
 * Both sides have the shape `{ schema, policies, tables: { [name]: { rows, rls, forced } } }`:
 * `schema` is a fingerprint of every column and its type, `policies` the number of row-level
 * security policies. The restored side adds the isolation probe: `crossTenantRows` (rows the
 * application role could read of another store — must be 0) and `ownRows` (rows it could read of
 * its own — must be more than 0, or the probe proves nothing).
 */
export function compareRestore(manifest, restored) {
  const problems = [];
  if (restored.schema !== manifest.schema) problems.push('schema: the restored columns and types differ from the backup');
  if (restored.policies !== manifest.policies) problems.push(`policies: ${manifest.policies} row-level security policies backed up, ${restored.policies} restored`);
  for (const [name, want] of Object.entries(manifest.tables)) {
    const got = restored.tables[name];
    if (!got) { problems.push(`${name}: missing from the restore`); continue; }
    if (got.rows !== want.rows) problems.push(`${name}: ${want.rows} rows backed up, ${got.rows} restored`);
    if (want.rls && !got.rls) problems.push(`${name}: row-level security is off after the restore`);
    if (want.forced && !got.forced) problems.push(`${name}: row-level security is no longer forced`);
  }
  for (const name of Object.keys(restored.tables)) {
    if (!(name in manifest.tables)) problems.push(`${name}: in the restore but not in the backup`);
  }
  if (restored.crossTenantRows !== 0) problems.push(`isolation: the application role read ${restored.crossTenantRows} rows of another store`);
  if (!(restored.ownRows > 0)) problems.push('isolation: the probe read none of its own store’s rows, so it proves nothing');
  return { ok: problems.length === 0, problems };
}
