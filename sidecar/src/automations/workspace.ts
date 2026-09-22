import { existsSync } from 'node:fs';
import {
  addWorktree,
  ensureWorktreeDirectoryIgnored,
  removeManagedWorktree,
  repositoryRoot,
  requireDirectory,
  requireRealDirectoryPath,
  resolveCommit,
  sanitizeSegment,
  worktreePath,
} from '../gitWorktrees.js';
import type { AutomationExecutionMode } from './types.js';

export interface PrepareAutomationWorkspaceInput {
  cwd: string | null;
  executionMode: AutomationExecutionMode;
  title: string;
  runId: string;
}

/** The part of a run that decides whether a workspace has to be cleaned up. */
export interface ReleasableAutomationWorkspace {
  resolvedCwd: string | null;
  executionMode: AutomationExecutionMode;
}

export type AutomationWorkspacePreparer = (
  input: PrepareAutomationWorkspaceInput,
) => Promise<string>;

export type AutomationWorkspaceCreator = (
  input: PrepareAutomationWorkspaceInput,
  resolvedCwd: string,
) => Promise<void>;

export type AutomationWorkspaceReleaser = (
  workspace: ReleasableAutomationWorkspace,
) => Promise<void>;

const OUTSIDE_REPOSITORY = 'The automation worktree path must stay inside the selected repository.';

/**
 * Chooses the directory a run will use. Isolated worktrees are not created yet:
 * the path is persisted first so a crash during `git worktree add` can still
 * release it on the next start.
 */
export async function resolveAutomationWorkspace(
  input: PrepareAutomationWorkspaceInput,
): Promise<string> {
  const selected = input.cwd ?? '';
  if (!selected.trim()) return '';
  await requireDirectory(selected, 'The selected automation workspace no longer exists.');
  if (input.executionMode === 'local') return selected;

  const root = await requireRepository(selected);
  const name = automationWorktreeName(input.title, input.runId);
  let target = worktreePath(root, name);
  for (let suffix = 2; existsSync(target); suffix += 1) {
    target = worktreePath(root, `${name}-${String(suffix)}`);
  }

  await ensureWorktreeDirectoryIgnored(root);
  await requireRealDirectoryPath(root, target, OUTSIDE_REPOSITORY);
  return target;
}

/** Creates the isolated worktree at a path that is already stored on the run. */
export async function createAutomationWorkspace(
  input: PrepareAutomationWorkspaceInput,
  resolvedCwd: string,
): Promise<void> {
  const target = resolvedCwd;
  if (!target.trim() || input.executionMode !== 'worktree') return;
  const selected = input.cwd ?? '';
  if (!selected.trim()) return;
  const root = await requireRepository(selected);
  const commit = await resolveCommit(root);
  if (!commit) throw new Error('The selected repository does not have a commit to run from.');
  await requireRealDirectoryPath(root, target, OUTSIDE_REPOSITORY);
  try {
    await addWorktree(root, target, commit);
  } catch (error) {
    throw new Error(`Could not create the automation worktree: ${errorMessage(error)}`);
  }
}

/**
 * Removes a run's isolated worktree once its chat is gone. A worktree holding
 * uncommitted or untracked work is kept: the automation's output lives there and
 * DROIDEX must not delete it.
 */
export async function releaseAutomationWorkspace(
  run: ReleasableAutomationWorkspace,
): Promise<void> {
  const target = run.resolvedCwd ?? '';
  if (run.executionMode !== 'worktree' || !target.trim() || !existsSync(target)) return;
  try {
    await removeManagedWorktree(target);
  } catch (error) {
    console.error('Could not remove the automation worktree', errorMessage(error));
  }
}

async function requireRepository(selected: string): Promise<string> {
  const root = await repositoryRoot(selected);
  if (!root) {
    throw new Error('An isolated worktree can only be created for a Git repository.');
  }
  const commit = await resolveCommit(root);
  if (!commit) throw new Error('The selected repository does not have a commit to run from.');
  return root;
}

function automationWorktreeName(title: string, runId: string): string {
  const suffix = sanitizeSegment(runId).slice(-6) || 'run';
  const intent = sanitizeSegment(title).slice(0, Math.max(8, 54 - suffix.length)) || 'automation';
  return `${intent}-${suffix}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
