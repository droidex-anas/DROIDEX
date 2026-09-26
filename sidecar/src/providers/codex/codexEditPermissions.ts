import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { objectValue } from '../../values.js';

const PROTECTED = new Set(['.git', '.codex', '.agents']);

// Approve only the paths described by this exact pending item. Missing or
// unfamiliar metadata retains the prompt; rename destinations are checked too.
export function canApproveWorkspaceEdits(cwd: string, changes: readonly unknown[]): boolean {
  if (changes.length === 0) return false;
  try {
    const root = realpathSync(cwd);
    return changes.every((change) => {
      const paths = editPaths(change);
      if (paths.length === 0) return false;
      return paths.every((path) => {
        const absolute = resolve(cwd, path);
        return (
          eligible(relative(resolve(cwd), absolute)) &&
          eligible(relative(root, resolveExistingParent(absolute)))
        );
      });
    });
  } catch {
    // Unreadable filesystem metadata cannot authorize a write.
    return false;
  }
}

function editPaths(value: unknown): string[] {
  const change = objectValue(value);
  const kind = objectValue(change?.kind);
  if (!change || typeof change.path !== 'string' || !change.path || !kind) return [];
  if (kind.type !== 'add' && kind.type !== 'delete' && kind.type !== 'update') return [];
  if (kind.movePath == null) return [change.path];
  if (typeof kind.movePath !== 'string' || !kind.movePath) return [];
  return [change.path, kind.movePath];
}

function eligible(path: string): boolean {
  const parts = path.split(sep);
  return (
    path !== '' &&
    !isAbsolute(path) &&
    parts[0] !== '..' &&
    !parts.some((part) => PROTECTED.has(part.toLowerCase()))
  );
}

function resolveExistingParent(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
    if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(resolveExistingParent(parent), basename(path));
  }
}
