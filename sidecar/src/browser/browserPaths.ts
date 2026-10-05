import { join, resolve, sep } from 'node:path';
import { droidexUserDataDir } from '../droidexPaths.js';

function browserDataRoot(baseDir = droidexUserDataDir()): string {
  return baseDir;
}

export function browserDesignReferenceDir(appSessionId: string, baseDir?: string): string {
  return join(browserDataRoot(baseDir), 'design-references', sanitizeSegment(appSessionId));
}

export function isBrowserAssetPath(filePath: string, baseDir?: string): boolean {
  const root = resolve(browserDataRoot(baseDir));
  const target = resolve(filePath);
  return target === root || target.startsWith(`${root}${sep}`);
}

function sanitizeSegment(value: string): string {
  const segment = value.trim().replace(/[^a-zA-Z0-9._-]/g, '-');
  return segment || 'default';
}
