const { repoStatus } = require('./gitRepository.cjs');
const gitEnvironment = require('./gitEnvironment.cjs');
const gitBranches = require('./gitBranches.cjs');
const gitWorktrees = require('./gitWorktrees.cjs');
const gitDiff = require('./gitDiff.cjs');
const gitSync = require('./gitSync.cjs');
const githubVcs = require('./github.cjs');
const githubPrConversation = require('./githubPrConversation.cjs');
const editorApps = require('./editorApps.cjs');
const { openProject } = require('./projectLauncher.cjs');
function prWorkspaceRequestDir(value) {
  if (typeof value !== 'string') return null;
  return value.trim() ? value : null;
}

function registerSourceControlIpc({ desktopIpc }) {
  desktopIpc.handle('repo-status', ({ dir }) => {
    return repoStatus(dir);
  });
  desktopIpc.handle('list-editors', () => {
    return editorApps.listEditors();
  });
  desktopIpc.handle('editor-icon', ({ editor }) => {
    return editorApps.editorIcon(editor);
  });
  desktopIpc.handle('open-project', ({ dir, editor, target }) => {
    return openProject(dir, editor, target);
  });

  desktopIpc.handle('git-environment', ({ dir }) => {
    return gitEnvironment.environment(dir);
  });
  desktopIpc.handle('git-branches', ({ dir }) => {
    return gitBranches.branches(dir);
  });
  desktopIpc.handle('git-worktrees', ({ dir }) => {
    return gitWorktrees.worktrees(dir);
  });
  desktopIpc.handle('git-diff-stat', ({ dir, options }) => {
    return gitDiff.diffStat(dir, options);
  });
  desktopIpc.handle('git-diff-files', ({ dir, options }) => {
    return gitDiff.diffFiles(dir, options);
  });
  desktopIpc.handle('git-file-diff', ({ dir, options }) => {
    return gitDiff.fileDiff(dir, options);
  });
  desktopIpc.handle('git-mark-turn-start', ({ dir, ownerId }) => {
    return gitDiff.markTurnStart(dir, ownerId);
  });
  desktopIpc.handle('git-adopt-turn-baseline', ({ dir, clientRef, appSessionId }) => {
    return gitDiff.adoptTurnBaseline(dir, clientRef, appSessionId);
  });
  desktopIpc.handle('git-create-branch', ({ dir, options }) => {
    return gitBranches.createBranch(dir, options);
  });
  desktopIpc.handle('git-checkout', ({ dir, options }) => {
    return gitBranches.checkout(dir, options);
  });
  desktopIpc.handle('git-create-worktree', ({ dir, options }) => {
    return gitWorktrees.createWorktree(dir, options);
  });
  desktopIpc.handle('git-remove-worktree', ({ dir, options }) => {
    return gitWorktrees.removeWorktree(dir, options);
  });
  desktopIpc.handle('git-commit', ({ dir, options }) => {
    return gitSync.commit(dir, options);
  });
  desktopIpc.handle('git-push', ({ dir, options }) => {
    return gitSync.push(dir, options);
  });
  desktopIpc.handle('git-fetch', ({ dir }) => {
    return gitSync.fetchRemotes(dir);
  });

  desktopIpc.handle('github-available', () => {
    return githubVcs.available();
  });
  desktopIpc.handle('github-install', () => {
    return githubVcs.install();
  });
  desktopIpc.handle('github-authenticate', (_payload, sender) => {
    return githubVcs.authenticate({
      onDeviceCode: (code) => {
        if (!sender.isDestroyed()) sender.send('github-auth-code', { code });
      },
    });
  });
  desktopIpc.handle('github-cancel-setup', () => {
    githubVcs.cancelSetup();
    return { ok: true };
  });
  desktopIpc.handle('github-detect-pr', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, pr: null };
    return githubVcs.detectPr(requestDir, options);
  });
  desktopIpc.handle('github-list-prs', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', viewerLogin: null, prs: [] };
    return githubVcs.listPrs(requestDir, options);
  });
  desktopIpc.handle('github-view-pr', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', pr: null };
    return githubVcs.viewPr(requestDir, options);
  });
  desktopIpc.handle('github-pr-diff', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', diff: '' };
    return githubVcs.prDiff(requestDir, options);
  });
  desktopIpc.handle('github-pr-checks', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', checks: [] };
    return githubVcs.prChecks(requestDir, options);
  });
  desktopIpc.handle('github-pr-comments', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', comments: [] };
    return githubPrConversation.prComments(requestDir, options);
  });
  desktopIpc.handle('github-create-pr', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid' };
    return githubVcs.createPr(requestDir, options);
  });
  desktopIpc.handle('github-post-comment', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid' };
    return githubVcs.postComment(requestDir, options);
  });
  desktopIpc.handle('github-merge-pr', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid' };
    return githubVcs.mergePr(requestDir, options);
  });
}

module.exports = { registerSourceControlIpc };
