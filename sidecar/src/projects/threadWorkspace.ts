import { existsSync } from 'node:fs';
import {
  addWorktree,
  ensureWorktreeDirectoryIgnored,
  git,
  repositoryRoot,
  requireDirectory,
  requireRealDirectoryPath,
  resolveCommit,
  sanitizeSegment,
  worktreePath,
} from '../gitWorktrees.js';

/* Where a thread does its work. Sharing the project's checkout is the default,
   because most threads read or touch different things. When two threads will
   write, the chat that starts them asks for a worktree: its own checkout on its
   own branch, cut from a base it names, so neither thread ever sees the other's
   half-finished tree. */

export interface ThreadWorkspaceRequest {
  /** The project's checkout, which the worktree is cut from. */
  cwd: string;
  title: string;
  /** Branch to create for the thread. Derived from the title when absent. */
  branch?: string;
  /** Commit-ish the branch starts at. The checkout's HEAD when absent. */
  base?: string;
}

export interface ThreadWorkspace {
  cwd: string;
  branch: string;
  base: string;
}

const OUTSIDE_REPOSITORY = 'A thread worktree must stay inside the project repository.';

export async function createThreadWorkspace(
  request: ThreadWorkspaceRequest,
): Promise<ThreadWorkspace> {
  const selected = request.cwd.trim();
  if (!selected) throw new Error('A thread worktree needs the project to have a workspace folder.');
  await requireDirectory(selected, 'The project workspace folder no longer exists.');

  const root = await repositoryRoot(selected);
  if (!root) throw new Error('A thread worktree can only be created for a Git repository.');
  const commit = await resolveCommit(root, request.base);
  if (!commit) {
    throw new Error(
      request.base?.trim()
        ? `The base ${request.base.trim()} does not resolve to a commit in this repository.`
        : 'The project repository does not have a commit to branch from.',
    );
  }

  const branch = await freeBranch(root, threadBranchName(request.branch ?? request.title));
  let target = worktreePath(root, branch.replaceAll('/', '-'));
  for (let suffix = 2; existsSync(target); suffix += 1) {
    target = worktreePath(root, `${branch.replaceAll('/', '-')}-${String(suffix)}`);
  }

  await ensureWorktreeDirectoryIgnored(root);
  await requireRealDirectoryPath(root, target, OUTSIDE_REPOSITORY);
  await addWorktree(root, target, commit, branch);
  return { cwd: target, branch, base: request.base?.trim() ?? 'HEAD' };
}

// Threads live under one prefix so a repository's branch list says which
// branches DROIDEX opened and which task each one carries.
function threadBranchName(value: string): string {
  // Sanitizing flattens a slash, so a chat asking for "thread/rename-api" must
  // not come back as thread/thread-rename-api.
  const stem =
    sanitizeSegment(value)
      .replace(/^thread[-/]/, '')
      .slice(0, 48) || 'work';
  return `thread/${stem}`;
}

async function freeBranch(root: string, name: string): Promise<string> {
  for (let suffix = 1; suffix < 50; suffix += 1) {
    const candidate = suffix === 1 ? name : `${name}-${String(suffix)}`;
    const exists = await git(root, ['rev-parse', '--verify', `refs/heads/${candidate}`]).catch(
      () => '',
    );
    if (!exists) return candidate;
  }
  throw new Error('Too many branches already use this thread name.');
}
