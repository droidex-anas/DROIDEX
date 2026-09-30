// Opens a chat's project folder, or its current changes as a diff file, in the
// editor or tool the user picked from the chat header.
const { app, shell } = require('electron');
const { spawn } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
// Everything launched here is one of the user's own tools, an editor or a
// terminal, and both go on to run shells, so neither gets the app's variables.
const { childEnv } = require('./childEnv.cjs');
const editorApps = require('./editorApps.cjs');
const git = require('./git.cjs');

async function openProject(dir, editor, target) {
  const root = await git.projectRoot(dir);
  const pathToOpen = target === 'diff' ? await writeDiffFile(root) : root;
  await launch(editor, pathToOpen, root, target);
}

async function writeDiffFile(root) {
  let diff;
  try {
    diff = await git.workingTreeDiff(root);
  } catch (err) {
    diff = `Unable to read git diff: ${err.message}\n`;
  }
  const dir = path.join(app.getPath('temp'), 'droidex-diffs');
  await fsp.mkdir(dir, { recursive: true });
  const name = (path.basename(root) || 'repo').replace(/[^\w.-]+/g, '-');
  const filePath = path.join(dir, `${name}-${Date.now()}.diff`);
  await fsp.writeFile(filePath, diff || 'No changes.\n', 'utf8');
  return filePath;
}

async function launch(editor, pathToOpen, root, target) {
  if (editor === 'finder') {
    if (target === 'diff') shell.showItemInFolder(pathToOpen);
    else await openPathOrThrow(pathToOpen);
    return;
  }
  if (editor === 'terminal') {
    if (target === 'diff') await openPathOrThrow(pathToOpen);
    else await openTerminal(root);
    return;
  }
  if (editor === 'cursor') return openApp('cursor', 'Cursor', 'cursor', pathToOpen);
  if (editor === 'xcode') return openApp('xcode', 'Xcode', 'xed', pathToOpen);
  return openApp('vscode', 'Visual Studio Code', 'code', pathToOpen);
}

async function openPathOrThrow(targetPath) {
  const error = await shell.openPath(targetPath);
  if (error) throw new Error(error);
}

// On macOS the target is the bundle the picker found (so a VSCodium-only
// machine opens VSCodium under the vscode entry), falling back to the app name
// when detection has nothing to say.
function openApp(editor, macAppName, command, targetPath) {
  if (process.platform === 'darwin') {
    const bundle = editorApps.macBundlePath(editor) ?? macAppName;
    return spawnDetached('open', ['-a', bundle, targetPath]);
  }
  return spawnDetached(command, [targetPath]);
}

function openTerminal(root) {
  if (process.platform === 'darwin') return spawnDetached('open', ['-a', 'Terminal', root]);
  if (process.platform === 'win32') return spawnDetached('cmd.exe', ['/k'], { cwd: root });
  return spawnDetached('x-terminal-emulator', ['--working-directory', root]);
}

function spawnDetached(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      cwd: options.cwd,
      env: childEnv(),
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = { openProject };
