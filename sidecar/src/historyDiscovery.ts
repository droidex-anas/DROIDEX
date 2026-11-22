import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { altSessionRoots } from './droidProfiles.js';
import { providerSessionsDir } from './droidexPaths.js';
import type { SessionFileScan, SessionFileStat } from './sessionFileCache.js';

function isMissingSessionPath(error: unknown): boolean {
  const { code } = error as NodeJS.ErrnoException;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export function scanSessionFileTree(): SessionFileScan {
  const files = new Map<string, SessionFileStat>();
  const unreadablePaths = new Set<string>();
  const settingsMtimes = new Map<string, number>();
  let isComplete = true;
  // Alt profiles are private extra logins, so they never replace or break a Main
  // chat: their roots are walked last, in profile order, and a file whose
  // identity an earlier root already has is skipped.
  const walk = (dir: string, depth: number, isAlt: boolean) => {
    if (depth > 4) return;
    // A directory can be removed between the root check and this readdir
    // (a parallel Droid CLI run compacting/deleting sessions). Skip a
    // vanished subtree instead of letting the throw abort the whole scan,
    // which would abort the cache reconcile it backs.
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      isComplete = false;
      return;
    }
    for (const name of names) {
      const path = join(dir, name);
      let stat;
      try {
        stat = statSync(path);
      } catch (error) {
        if (!isMissingSessionPath(error)) {
          if (name.endsWith('.jsonl')) unreadablePaths.add(path);
          else if (!name.endsWith('.settings.json')) isComplete = false;
        }
        continue;
      }
      if (stat.isDirectory()) walk(path, depth + 1, isAlt);
      else if (name.endsWith('.jsonl')) {
        const id = name.slice(0, -'.jsonl'.length);
        if (isAlt && files.has(id)) continue;
        files.set(id, {
          path,
          birthtimeMs: stat.birthtimeMs,
          mtimeMs: stat.mtimeMs,
          sizeBytes: stat.size,
          settingsMtimeMs: null,
        });
      } else if (name.endsWith('.settings.json')) {
        settingsMtimes.set(path, stat.mtimeMs);
      }
    }
  };
  for (const root of [join(homedir(), '.factory', 'sessions'), providerSessionsDir()])
    if (existsSync(root)) walk(root, 0, false);
  for (const { root } of altSessionRoots()) if (existsSync(root)) walk(root, 0, true);
  for (const file of files.values()) {
    file.settingsMtimeMs =
      settingsMtimes.get(file.path.replace(/\.jsonl$/, '.settings.json')) ?? null;
  }
  return { files, unreadablePaths, isComplete };
}

// Stats one session file and its settings sidecar. Null means the file is gone;
// other inspection failures throw so reconciliation can retry later.
export function statSessionFile(path: string): SessionFileStat | null {
  try {
    const stat = statSync(path);
    let settingsMtimeMs: number | null = null;
    try {
      settingsMtimeMs = statSync(path.replace(/\.jsonl$/, '.settings.json')).mtimeMs;
    } catch {
      settingsMtimeMs = null;
    }
    return {
      path,
      birthtimeMs: stat.birthtimeMs,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      settingsMtimeMs,
    };
  } catch (error) {
    if (isMissingSessionPath(error)) return null;
    throw error;
  }
}
