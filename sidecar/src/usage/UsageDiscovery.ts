import { lstat, opendir, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { nonEmptyEnv } from '../droidexPaths.js';
import type { UsageParserName } from './types.js';

export interface UsageSourceRoot {
  parserName: UsageParserName;
  path: string;
}

export interface UsageSourceFile extends UsageSourceRoot {
  rootPath: string;
}

export type UsageDiscoveryItem = UsageSourceFile | 'entry' | 'unavailable';

export function defaultUsageRoots(): UsageSourceRoot[] {
  const home = homedir();
  const claudeHome = nonEmptyEnv(process.env.CLAUDE_CONFIG_DIR, join(home, '.claude'));
  const codexHome = nonEmptyEnv(process.env.CODEX_HOME, join(home, '.codex'));
  return [
    { parserName: 'claude-code', path: join(claudeHome, 'projects') },
    { parserName: 'codex', path: join(codexHome, 'sessions') },
    { parserName: 'codex', path: join(codexHome, 'archived_sessions') },
  ];
}

export async function* discoverUsageFiles(
  roots: readonly UsageSourceRoot[],
): AsyncGenerator<UsageDiscoveryItem> {
  for (const root of roots) {
    const stats = await lstat(root.path).catch(() => null);
    if (!stats) continue;
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      yield 'unavailable';
      continue;
    }
    let canonicalRoot: string;
    try {
      canonicalRoot = await realpath(root.path);
    } catch {
      yield 'unavailable';
      continue;
    }
    yield* walkDirectory(root.parserName, canonicalRoot, canonicalRoot);
  }
}

async function* walkDirectory(
  parserName: UsageParserName,
  rootPath: string,
  directoryPath: string,
): AsyncGenerator<UsageDiscoveryItem> {
  let directory;
  try {
    directory = await opendir(directoryPath);
  } catch {
    yield 'unavailable';
    return;
  }
  try {
    for await (const entry of directory) {
      const path = join(directoryPath, entry.name);
      if (entry.isSymbolicLink()) {
        yield 'entry';
      } else if (entry.isDirectory()) {
        yield 'entry';
        yield* walkDirectory(parserName, rootPath, path);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        yield { parserName, rootPath, path };
      } else {
        yield 'entry';
      }
    }
  } catch {
    yield 'unavailable';
  }
}
