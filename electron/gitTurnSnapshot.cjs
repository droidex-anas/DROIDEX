const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { run, tryRun } = require('./gitCommand.cjs');

async function captureTrackedTurnBaseline(root) {
  const stash = await tryRun(root, ['stash', 'create']);
  if (stash) return stash;
  const head = await tryRun(root, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  if (head) return head;
  // Stash needs a first commit. Update a copy of the index so the baseline
  // includes pre-turn working-tree edits without staging them for the user.
  const indexPath = (await run(root, ['rev-parse', '--git-path', 'index'])).replace(/\r?\n$/, '');
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'droidex-turn-index-'));
  try {
    const indexFile = path.join(tempDir, 'index');
    await fsp.copyFile(path.resolve(root, indexPath), indexFile).catch((err) => {
      if (err.code !== 'ENOENT') throw err;
    });
    const config = ['-c', 'core.splitIndex=false'];
    await run(root, [...config, 'add', '--update'], { indexFile });
    return (await run(root, [...config, 'write-tree'], { indexFile })).trim();
  } finally {
    await fsp.rm(tempDir, { recursive: true, force: true });
  }
}

module.exports = { captureTrackedTurnBaseline };
