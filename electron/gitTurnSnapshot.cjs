const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run, tryRun } = require('./gitCommand.cjs');

async function captureTrackedTurnBaseline(root) {
  const head = await tryRun(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head) return (await tryRun(root, ['stash', 'create'])) || head;
  // Stash needs a first commit. Update a copy of the index so the baseline
  // includes pre-turn working-tree edits without staging them for the user.
  const indexPath = (await run(root, ['rev-parse', '--git-path', 'index'])).replace(/\r?\n$/, '');
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'droidex-turn-index-'));
  try {
    const indexFile = path.join(tempDir, 'index');
    await fsp.copyFile(path.resolve(root, indexPath), indexFile).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    // Read an existing split index, but don't write shared index files.
    const noSplitIndex = ['-c', 'core.splitIndex=false'];
    const writeTree = [...noSplitIndex, 'write-tree'];
    const options = { indexFile };
    const stagedTree = (await run(root, writeTree, options)).trim();
    // Safe CRLF checks protect staging, not a read-only comparison snapshot.
    const updated = await tryRun(
      root,
      [...noSplitIndex, '-c', 'core.safecrlf=false', 'add', '--update'],
      options,
    );
    // A broken clean filter can still prevent a working-tree snapshot. Keep
    // the staged baseline so Last turn continues to show unrelated files.
    if (updated === null) return stagedTree;
    return (await tryRun(root, writeTree, options)) || stagedTree;
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { captureTrackedTurnBaseline };
