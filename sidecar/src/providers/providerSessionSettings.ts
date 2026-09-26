// Launch settings for a stored session on a provider that keeps no session file
// of its own. The history scan already reads `<session>.settings.json` beside a
// transcript and re-keys its file cache on that file's mtime, so writing one is
// all a closed chat needs for a model change to outlive the app.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { providerSessionsDir } from '../droidexPaths.js';
import { objectValue } from '../values.js';
import type { ProviderModelSettings } from './session.js';

export function writeProviderSessionSettings(
  appSessionId: string,
  { modelId, reasoningEffort, fastMode }: ProviderModelSettings,
): void {
  const directory = providerSessionsDir();
  // Settings belong to a conversation; a session that never wrote a transcript
  // has none to attach them to.
  if (!existsSync(join(directory, `${appSessionId}.jsonl`))) return;
  const path = join(directory, `${appSessionId}.settings.json`);
  const stored = readSettings(path);
  // Written even for "back to the provider's own default": a null here is the
  // record that the chat has no model of its own, which dropping the key would
  // leave to the transcript head's original one.
  if (modelId !== undefined) stored.modelId = modelId;
  if (reasoningEffort) stored.reasoningEffort = reasoningEffort;
  if (fastMode !== undefined) stored.fastMode = fastMode;
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, JSON.stringify(stored));
}

function readSettings(path: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(readFileSync(path, 'utf8'))) ?? {};
  } catch {
    return {};
  }
}
