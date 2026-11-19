const { expandHome, isWithin, repoStatus, projectRoot } = require('./gitRepository.cjs');
const { environment, matchRemote } = require('./gitEnvironment.cjs');
const { branches, validBranchName, createBranch, checkout } = require('./gitBranches.cjs');
const {
  worktrees,
  sanitizeSegment,
  allowedWorktreeTarget,
  createWorktree,
  removeWorktree,
} = require('./gitWorktrees.cjs');
const {
  workingTreeDiff,
  diffStat,
  diffFiles,
  fileDiff,
  markTurnStart,
  adoptTurnBaseline,
} = require('./gitDiff.cjs');
const { commit, push, fetchRemotes } = require('./gitSync.cjs');

module.exports = {
  expandHome,
  environment,
  repoStatus,
  projectRoot,
  workingTreeDiff,
  branches,
  // Pure validation helpers exported for unit tests: they are the security
  // boundary for branch names, worktree paths, and remote resolution.
  validBranchName,
  sanitizeSegment,
  allowedWorktreeTarget,
  matchRemote,
  isWithin,
  worktrees,
  diffStat,
  diffFiles,
  fileDiff,
  markTurnStart,
  adoptTurnBaseline,
  createBranch,
  checkout,
  createWorktree,
  removeWorktree,
  commit,
  push,
  fetchRemotes,
};
