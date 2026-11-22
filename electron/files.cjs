/**
 * Secure root-bound Files-domain backend helpers.
 *
 * Every operation takes a canonical session root plus a relative path and
 * refuses to follow absolute paths, traversal segments, out-of-root targets,
 * or symlink escapes. The resolved target must additionally be a regular file
 * (or directory for listDirectory) before any bytes are read.
 *
 * This module is intentionally free of `require('electron')` at module load
 * so it can be unit-tested under plain Node. Callers in the main process
 * (electron/filesIpc.cjs) inject the Electron `shell` object when wiring up the
 * `openDefault` / `revealInFolder` IPC handlers, which keeps these helpers
 * deterministic and testable.
 *
 * Exported contract (consumed by the renderer via IPC):
 *   listDirectory(rootDir, relativePath?, options?) -> Promise<DirectoryListing>
 *   readPreview(rootDir, relativePath, options?)    -> Promise<PreviewPayload>
 *   openDefault(rootDir, relativePath, shell)       -> Promise<OpenResult>
 *   revealInFolder(rootDir, relativePath, shell)    -> Promise<OpenResult>
 *   classifyByName(name)                             -> PreviewCategory
 *
 * The classification tables mirror src/lib/filePreview.ts. Keep them in sync;
 * the paired unit tests exercise the shared edge cases.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { resolveWithin } = require('./filesPathSecurity.cjs');

const LISTING_CAP_DEFAULT = 1000;
const LISTING_CAP_MAX = 5000;
const TEXT_PREVIEW_CAP_BYTES = 5 * 1024 * 1024; // 5 MiB
const BINARY_PREVIEW_CAP_BYTES = 25 * 1024 * 1024; // 25 MiB
// Number of leading bytes inspected to detect misclassified binary content
// masquerading as text (e.g. NUL bytes from a `.json` that is actually a
// packed binary). Reading the whole file first would defeat the size cap.
const TEXT_BINARY_PROBE_BYTES = 8192;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'log',
  'md',
  'markdown',
  'mdx',
  'json',
  'json5',
  'jsonc',
  'csv',
  'tsv',
  'yaml',
  'yml',
  'xml',
  'html',
  'htm',
  'xhtml',
  'css',
  'scss',
  'sass',
  'less',
  'styl',
  'js',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'jsx',
  'py',
  'pyi',
  'rb',
  'php',
  'go',
  'rs',
  'c',
  'h',
  'cc',
  'cpp',
  'hpp',
  'cs',
  'java',
  'kt',
  'swift',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  'lua',
  'pl',
  'r',
  'scala',
  'clj',
  'cljs',
  'ex',
  'exs',
  'erl',
  'hs',
  'ml',
  'mli',
  'fs',
  'fsi',
  'vim',
  'toml',
  'ini',
  'cfg',
  'conf',
  'config',
  'properties',
  'env',
  'editorconfig',
  'sql',
  'graphql',
  'gql',
  'diff',
  'patch',
]);

const TEXT_FILENAMES = new Set([
  'dockerfile',
  'makefile',
  'rakefile',
  'gemfile',
  'procfile',
  'babelrc',
  'eslintrc',
  'prettierrc',
  'gitignore',
  'gitattributes',
  'npmrc',
  'yarnrc',
  'nvmrc',
  'bashrc',
  'zshrc',
  'profile',
]);

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'avif',
  'ico',
  'svg',
]);
const PDF_EXTENSIONS = new Set(['pdf']);
const DOCX_EXTENSIONS = new Set(['docx']);
const XLSX_EXTENSIONS = new Set(['xlsx']);

function extensionOf(name) {
  const lower = String(name).toLowerCase();
  const base = lower.split(/[\\/]/).pop() ?? lower;
  if (TEXT_FILENAMES.has(base)) return base;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) {
    // No extension. For dotfiles such as ".gitignore", strip the leading dot
    // so TEXT_FILENAMES can match "gitignore" without storing the dot.
    return base.startsWith('.') ? base.slice(1) : base;
  }
  return base.slice(dot + 1);
}

function classifyByName(name) {
  const ext = extensionOf(name);
  if (TEXT_EXTENSIONS.has(ext) || TEXT_FILENAMES.has(ext)) return 'text';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (PDF_EXTENSIONS.has(ext)) return 'pdf';
  if (DOCX_EXTENSIONS.has(ext)) return 'docx';
  if (XLSX_EXTENSIONS.has(ext)) return 'xlsx';
  return 'external';
}

function previewSizeCap(category) {
  return category === 'text' ? TEXT_PREVIEW_CAP_BYTES : BINARY_PREVIEW_CAP_BYTES;
}

function compareEntries(a, b) {
  if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/**
 * Non-recursive directory listing.
 *
 * Returns folders-first, alphabetical entries capped at `options.cap`
 * (default 1000, hard-clamped to LISTING_CAP_MAX). Each entry carries its
 * name and kind. The payload reports whether the cap truncated the result so
 * the UI can warn the user.
 */
async function listDirectory(rootDir, relativePath, options = {}) {
  const cap = clampCap(options.cap);
  const resolved = await resolveWithin(rootDir, relativePath);
  const stat = await fsp.lstat(resolved.target);
  if (!stat.isDirectory()) {
    const err = new Error('not a directory');
    err.code = 'ENOTDIR';
    throw err;
  }
  let dirents;
  try {
    dirents = await fsp.readdir(resolved.target, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return {
        root: resolved.root,
        relative: resolved.relative,
        entries: [],
        totalSeen: 0,
        capped: false,
        permissionDenied: true,
      };
    }
    throw err;
  }
  const entries = [];
  let totalSeen = 0;
  let capped = false;
  for (const dirent of dirents) {
    // Skip socket / FIFO / device / unknown node types entirely; only files
    // and directories are meaningful in the Files tab.
    if (!dirent.isDirectory() && !dirent.isFile()) continue;
    totalSeen += 1;
    if (entries.length >= cap) {
      capped = true;
      continue;
    }
    entries.push({
      name: dirent.name,
      kind: dirent.isDirectory() ? 'directory' : 'file',
    });
  }
  entries.sort(compareEntries);
  return {
    root: resolved.root,
    relative: resolved.relative,
    entries,
    totalSeen,
    capped,
    permissionDenied: false,
  };
}

function clampCap(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return LISTING_CAP_DEFAULT;
  return Math.min(Math.floor(n), LISTING_CAP_MAX);
}

async function readExactBytes(handle, length) {
  const buffer = Buffer.alloc(length);
  let offset = 0;
  while (offset < length) {
    const { bytesRead } = await handle.read(buffer, offset, length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== length) {
    throw new Error('file changed during preview');
  }
  return buffer;
}

// Opens the target without following a final symlink and confirms the open
// handle is a regular file that still sits at that path, so a swap between
// resolution and open cannot redirect the read or the launch.
async function openRegularFile(target, changedMessage) {
  const noFollow = process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW;
  const handle = await fsp.open(target, fs.constants.O_RDONLY | noFollow);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) {
      const err = new Error('not a file');
      err.code = 'EINVAL';
      throw err;
    }
    const pathStat = await fsp.lstat(target);
    if (stat.dev !== pathStat.dev || stat.ino !== pathStat.ino) {
      throw new Error(changedMessage);
    }
    return { handle, stat };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Reads a preview payload for a single file under the session root.
 *
 * Behaviour by category:
 *   - text:  returns `{ text }` decoded as UTF-8, capped at TEXT_PREVIEW_CAP_BYTES.
 *   - image/pdf/docx/xlsx: returns `{ data: Buffer }` capped at BINARY_PREVIEW_CAP_BYTES.
 *   - external: no payload is read; the UI should fall back to opening the file
 *     in its OS default application. Returning early avoids hauling large
 *     macro-enabled or legacy payloads through IPC.
 *
 * Files larger than the category cap return `{ oversize: true }` with metadata
 * and no payload, so the UI can prompt the user to open externally rather than
 * silently truncating.
 */
async function readPreview(rootDir, relativePath) {
  const resolved = await resolveWithin(rootDir, relativePath);
  const { handle, stat } = await openRegularFile(resolved.target, 'file changed during preview');
  try {
    const name = path.basename(resolved.target);
    const category = classifyByName(name);
    const totalSize = stat.size;
    const sizeCapBytes = previewSizeCap(category);

    if (category === 'external') {
      return {
        category,
        totalSize,
        mtimeMs: stat.mtimeMs,
        sizeCapBytes,
        previewable: false,
        reason: 'external-fallback',
        path: { root: resolved.root, relative: resolved.relative },
      };
    }

    if (totalSize > sizeCapBytes) {
      return {
        category,
        totalSize,
        mtimeMs: stat.mtimeMs,
        sizeCapBytes,
        previewable: true,
        oversize: true,
        path: { root: resolved.root, relative: resolved.relative },
      };
    }

    const buffer = await readExactBytes(handle, totalSize);
    if (category === 'text') {
      if (containsBinaryProbe(buffer)) {
        return {
          category: 'external',
          totalSize,
          mtimeMs: stat.mtimeMs,
          sizeCapBytes: BINARY_PREVIEW_CAP_BYTES,
          previewable: false,
          reason: 'binary-in-text-extension',
          path: { root: resolved.root, relative: resolved.relative },
        };
      }
      return {
        category: 'text',
        totalSize,
        mtimeMs: stat.mtimeMs,
        sizeCapBytes,
        previewable: true,
        encoding: 'utf8',
        text: buffer.toString('utf8'),
        path: { root: resolved.root, relative: resolved.relative },
      };
    }
    return {
      category,
      totalSize,
      mtimeMs: stat.mtimeMs,
      sizeCapBytes,
      previewable: true,
      encoding: 'binary',
      data: buffer,
      path: { root: resolved.root, relative: resolved.relative },
    };
  } finally {
    await handle.close();
  }
}

function containsBinaryProbe(buffer) {
  const len = Math.min(buffer.length, TEXT_BINARY_PROBE_BYTES);
  for (let i = 0; i < len; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

/**
 * Opens a file in the OS default application. The Electron `shell` object is
 * injected by the caller so this function remains testable without Electron.
 * `shell` is expected to expose `openPath(target) -> Promise<string>` (an
 * empty string on success, per Electron's contract).
 */
async function openDefault(rootDir, relativePath, shell) {
  const resolved = await resolveWithin(rootDir, relativePath);
  const openPath = shell?.openPath;
  if (typeof openPath !== 'function') {
    throw new Error('shell.openPath is required');
  }
  const { handle } = await openRegularFile(resolved.target, 'file changed before open');
  try {
    const openError = await openPath(resolved.target);
    if (typeof openError === 'string' && openError !== '') {
      throw new Error(openError);
    }
  } finally {
    await handle.close();
  }
  return { opened: true, target: resolved.target, root: resolved.root };
}

/**
 * Reveals a file in the platform file manager (Finder / Explorer / etc.).
 * `shell.showItemInFolder(target)` is synchronous in Electron and returns
 * void; we still `await` it so test doubles can be async.
 */
async function revealInFolder(rootDir, relativePath, shell) {
  const resolved = await resolveWithin(rootDir, relativePath);
  // Allow reveal on directories too: selecting a folder in Finder is a normal
  // Files-tab interaction. We only require the path to exist.
  const showItem = shell?.showItemInFolder;
  if (typeof showItem !== 'function') {
    throw new Error('shell.showItemInFolder is required');
  }
  await showItem(resolved.target);
  return { revealed: true, target: resolved.target, root: resolved.root };
}

module.exports = {
  listDirectory,
  readPreview,
  openDefault,
  revealInFolder,
  classifyByName,
  // constants (also useful to consumers / tests)
  LISTING_CAP_MAX,
  TEXT_PREVIEW_CAP_BYTES,
  BINARY_PREVIEW_CAP_BYTES,
};
