import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { providerSessionsDir } from './droidexPaths.js';
import type { Autonomy } from './protocol.js';
import { providerKind, type ProviderKind } from './providers/providerKind.js';
import { readSessionStart } from './sessionFileHead.js';
import { objectValue } from './values.js';

export const PERMISSION_SEMANTICS_REVISION = 1;
const REVISION_KEY = 'permissions.semantics_revision';

function migrateAutonomy(provider: ProviderKind, autonomy: Autonomy): Autonomy {
  if (autonomy !== 'low' && autonomy !== 'medium') return autonomy;
  if (provider === 'claude') return 'off';
  if (provider === 'codex') return 'medium';
  return autonomy;
}

// Brief 13 explicitly supports the previous permission meanings. Remove this
// conversion when that upgrade window closes; revision 1 is always canonical.
export function migrateHistoryPermissions(db: DatabaseSync): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    const revision = db
      .prepare('SELECT value_json FROM settings WHERE scope = ?')
      .get(REVISION_KEY);
    if (revision?.value_json === String(PERMISSION_SEMANTICS_REVISION)) {
      db.exec('COMMIT');
      return;
    }
    if (revision) throw new Error('Unsupported stored permission semantics revision.');
    const rows = db.prepare('SELECT app_session_id, autonomy FROM app_sessions').all();
    const update = db.prepare('UPDATE app_sessions SET autonomy = ? WHERE app_session_id = ?');
    for (const row of rows) {
      if (typeof row.app_session_id !== 'string') continue;
      if (row.autonomy !== 'low' && row.autonomy !== 'medium') continue;
      const path = join(providerSessionsDir(), `${row.app_session_id}.jsonl`);
      // Droid has no app-owned transcript binding and its values stay unchanged.
      if (!existsSync(path)) continue;
      const start = readSessionStart(path, statSync(path).size);
      const provider = providerKind(start.provider);
      if (provider) update.run(migrateAutonomy(provider, row.autonomy), row.app_session_id);
    }
    db.prepare('INSERT INTO settings (scope, value_json, updated_at) VALUES (?, ?, ?)').run(
      REVISION_KEY,
      String(PERMISSION_SEMANTICS_REVISION),
      Date.now(),
    );
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Persist the conversion beside app-owned transcripts so rebuilding the file
// cache cannot revive old semantics. Harness-owned files are never rewritten.
export function migrateTranscriptPermissions(
  path: string,
  provider: ProviderKind,
  autonomy: Autonomy | undefined,
  headRevision: unknown,
): Autonomy | undefined {
  if (provider === 'droid') return autonomy;
  if (dirname(resolve(path)) !== resolve(providerSessionsDir()))
    throw new Error('Provider permission settings must live in the DROIDEX profile.');
  const settingsPath = path.replace(/\.jsonl$/, '.settings.json');
  const settings = existsSync(settingsPath)
    ? objectValue(JSON.parse(readFileSync(settingsPath, 'utf8')))
    : {};
  if (!settings) throw new Error('Provider permission settings must be an object.');
  const revision = settings.permissionSemanticsRevision !== undefined
    ? settings.permissionSemanticsRevision
    : headRevision;
  if (revision === PERMISSION_SEMANTICS_REVISION) return autonomy ?? 'off';
  if (revision !== undefined) throw new Error('Unsupported stored permission semantics revision.');
  const migrated = migrateAutonomy(provider, autonomy ?? 'off');
  const temporaryPath = `${settingsPath}.${String(process.pid)}.tmp`;
  writeFileSync(
    temporaryPath,
    JSON.stringify({
      ...settings,
      autonomyLevel: migrated,
      permissionSemanticsRevision: PERMISSION_SEMANTICS_REVISION,
    }),
    { mode: 0o600 },
  );
  renameSync(temporaryPath, settingsPath);
  return migrated;
}
