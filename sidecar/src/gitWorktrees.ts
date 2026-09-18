import { execFile } from 'node:child_process';
import { appendFile, lstat, mkdir, readFile, realpath, rmdir, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';

/* The git plumbing DROIDEX uses whenever it runs work in its own worktree —
   automation runs and project threads. Both keep the same shape,
   `<repo>/.worktrees/<name>/<repo>`, so a person can tell at a glance which
   checkouts the app made, and both refuse a path that leaves the repository
   through a symlink. */

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const MAX_BUFFER = 4 * 1024 * 1024;

export async function git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  const result = await execFileAsync('git', ['-C', cwd, ...args], {
    timeout,
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return result.stdout.trim();
}

export async function requireDirectory(path: string, message: string): Promise<void> {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    // The clear error below is shared by missing files and non-directories.
  }
  throw new Error(message);
}

export async function repositoryRoot(cwd: string): Promise<string> {
  return await git(cwd, ['rev-parse', '--show-toplevel']).catch(() => '');
}

/** The commit a new worktree starts from: an explicit base, else the checkout's HEAD. */
export async function resolveCommit(root: string, base?: string): Promise<string> {
  const revision = base?.trim() ? `${base.trim()}^{commit}` : 'HEAD^{commit}';
  return await git(root, ['rev-parse', '--verify', revision]).catch(() => '');
}

export function worktreePath(root: string, name: string): string {
  return join(root, '.worktrees', name, basename(root));
}

export function sanitizeSegment(value: string): string {
  return value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[̀-ͯ]/g, '')
    .replace(new RegExp(`[${escapeRegExp(sep)}]+`, 'g'), '-')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .replace(/-+/g, '-');
}

/**
 * Rejects a worktree path that leaves the repository through a symbolic link, so
 * a planted `.worktrees` link cannot redirect DROIDEX's writes elsewhere.
 */
export async function requireRealDirectoryPath(
  root: string,
  target: string,
  outsideMessage: string,
): Promise<void> {
  const relativePath = relative(root, target);
  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error(outsideMessage);
  }
  let current = root;
  for (const segment of relativePath.split(sep)) {
    current = join(current, segment);
    const entry = await lstat(current).catch(() => null);
    if (!entry) return;
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(
        `Could not create the worktree because ${current} is not a real directory. Remove or rename it and try again.`,
      );
    }
  }
}

export async function ensureWorktreeDirectoryIgnored(root: string): Promise<void> {
  try {
    const commonDirRaw = await git(root, ['rev-parse', '--git-common-dir']);
    const commonDir = isAbsolute(commonDirRaw) ? commonDirRaw : resolve(root, commonDirRaw);
    const excludePath = join(commonDir, 'info', 'exclude');
    let contents = '';
    try {
      contents = await readFile(excludePath, 'utf8');
    } catch {
      // The file is optional and can be created lazily.
    }
    if (/^\/?\.worktrees\/?$/m.test(contents)) return;
    await mkdir(dirname(excludePath), { recursive: true });
    const prefix = contents && !contents.endsWith('\n') ? '\n' : '';
    await appendFile(excludePath, `${prefix}/.worktrees/\n`, 'utf8');
  } catch {
    // Ignoring the folder is best effort; worktree creation remains authoritative.
  }
}

/** Adds the worktree, on its own branch when one is named. */
export async function addWorktree(
  root: string,
  target: string,
  commit: string,
  branch?: string,
): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  const args = branch
    ? ['worktree', 'add', '-b', branch, target, commit]
    : ['worktree', 'add', '--detach', target, commit];
  await git(root, args, 90_000);
}

export function parseWorktreePaths(output: string): string[] {
  return output
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

export async function registeredWorktreePath(
  worktrees: readonly string[],
  target: string,
): Promise<string | null> {
  const targetPath = await realpath(target);
  for (const worktree of worktrees) {
    if ((await realpath(worktree).catch(() => '')) === targetPath) return worktree;
  }
  return null;
}

/** True when the path is one DROIDEX made: `<repo>/.worktrees/<name>/<repo>`. */
export async function isManagedWorktreePath(
  worktrees: readonly string[],
  target: string,
): Promise<boolean> {
  const targetPath = await realpath(target);
  for (const worktree of worktrees) {
    const ownerPath = await realpath(worktree).catch(() => '');
    if (!ownerPath || ownerPath === targetPath) continue;
    const parts = relative(ownerPath, targetPath).split(sep);
    if (
      parts.length === 3 &&
      parts[0] === '.worktrees' &&
      Boolean(parts[1]) &&
      parts[2] === basename(ownerPath)
    ) {
      return true;
    }
  }
  return false;
}

/** Removes a worktree DROIDEX made, keeping any that still holds work. */
export async function removeManagedWorktree(target: string): Promise<void> {
  const worktrees = parseWorktreePaths(await git(target, ['worktree', 'list', '--porcelain']));
  const main = worktrees[0];
  const canonicalTarget = await registeredWorktreePath(worktrees, target);
  if (!main || !canonicalTarget || !(await isManagedWorktreePath(worktrees, canonicalTarget))) {
    return;
  }
  if (await git(target, ['status', '--porcelain'])) return;
  await git(main, ['worktree', 'remove', canonicalTarget]);
  await git(main, ['worktree', 'prune']);
  await rmdir(dirname(canonicalTarget)).catch(() => undefined);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
