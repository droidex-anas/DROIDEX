// Launch settings for a stored session on a provider that keeps no session file
// of its own. The history scan already reads `<session>.settings.json` beside a
// transcript and re-keys its file cache on that file's mtime, so writing one is
// all a closed chat needs for a model change to outlive the app.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { providerSessionsDir } from '../droidexPaths.js';
import type { ProviderModelSettings } from './session.js';

export function writeProviderSessionSettings(
  appSessionId: string,
  { modelId, reasoningEffort }: ProviderModelSettings,
): void {
  const directory = providerSessionsDir();
  // Settings belong to a conversation; a session that never wrote a transcript
  // has none to attach them to.
  if (!existsSync(join(directory, `${appSessionId}.jsonl`))) return;
  const path = join(directory, `${appSessionId}.settings.json`);
  const stored = readSettings(path);
  // A null model is "back to the provider's own default", which is what the
  // absence of the setting already means.
  if (modelId === null) delete stored.modelId;
  else if (modelId !== undefined) stored.modelId = modelId;
  if (reasoningEffort) stored.reasoningEffort = reasoningEffort;
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, JSON.stringify(stored));
}

function readSettings(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}
