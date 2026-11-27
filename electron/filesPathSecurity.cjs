const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function assertString(value, name) {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
}

async function canonicalDirectory(rootDir) {
  assertString(rootDir, 'rootDir');
  if (!rootDir.trim()) throw new Error('rootDir is required');
  const root = await fsp.realpath(path.resolve(rootDir));
  const stat = await fsp.stat(root);
  if (!stat.isDirectory()) {
    const err = new Error('not a directory');
    err.code = 'ENOTDIR';
    throw err;
  }
  return root;
}

function createRootAccessRegistry(options = {}) {
  const rootsByToken = new Map();
  const tokensByRoot = new Map();
  const createToken = options.createToken ?? (() => crypto.randomBytes(32).toString('base64url'));

  return {
    async authorize(rootDir) {
      const root = await canonicalDirectory(rootDir);
      const existing = tokensByRoot.get(root);
      if (existing) return existing;
      const token = createToken();
      if (typeof token !== 'string' || token.length < 16 || rootsByToken.has(token)) {
        throw new Error('failed to create a unique files access token');
      }
      rootsByToken.set(token, root);
      tokensByRoot.set(root, token);
      return token;
    },

    async tokenFor(rootDir) {
      const root = await canonicalDirectory(rootDir);
      return tokensByRoot.get(root) ?? null;
    },

    resolve(token) {
      if (typeof token !== 'string' || !rootsByToken.has(token)) {
        const err = new Error('Files access has not been authorized for this workspace.');
        err.code = 'EACCES';
        throw err;
      }
      return rootsByToken.get(token);
    },

    clear() {
      rootsByToken.clear();
      tokensByRoot.clear();
    },
  };
}

/**
 * Lexically validates that `relativePath` cannot escape `rootDir`. Returns the
 * resolved absolute target plus the canonical relative segment. Does NOT touch
 * the filesystem, so it is safe to use as a pre-check before any I/O.
 *
 * Rejects:
 *   - non-string inputs
 *   - absolute paths (including Windows drive roots)
 *   - NUL / control characters
 *   - segments that resolve above the root via `..`
 */
function validateRelative(rootDir, relativePath) {
  assertString(rootDir, 'rootDir');
  const root = path.resolve(rootDir);
  if (relativePath === undefined || relativePath === null || relativePath === '') {
    return { root, target: root, relative: '' };
  }
  if (typeof relativePath !== 'string') {
    throw new Error('relativePath must be a string');
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error('absolute path rejected');
  }
  if ([...relativePath].some((character) => character.charCodeAt(0) <= 0x1f)) {
    throw new Error('invalid characters in path');
  }
  const target = path.resolve(root, relativePath);
  const relative = path.relative(root, target);
  if (escapesRoot(relative)) {
    throw new Error('path escapes root');
  }
  return { root, target, relative };
}

function escapesRoot(relative) {
  return path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`);
}

/**
 * Resolves `rootDir`/`relativePath` against the real filesystem and guarantees
 * the target's realpath stays inside the realpath of the root. This catches
 * symlink escapes that the lexical check cannot see. The target must already
 * exist (realpath throws ENOENT otherwise); callers that need to handle
 * missing paths should catch that code explicitly.
 */
async function resolveWithin(rootDir, relativePath) {
  const lexical = validateRelative(rootDir, relativePath);
  const rootReal = await fsp.realpath(lexical.root);
  // Re-run the lexical check against the real root in case the supplied root
  // contained symlink segments that change which directory we actually land in.
  const targetLexical = path.resolve(rootReal, lexical.relative);
  let targetReal;
  try {
    targetReal = await fsp.realpath(targetLexical);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // Broken or dangling symlink: realpath can no longer resolve it, so
      // walk each component with readlink to still catch escapes.
      await assertNoSymlinkEscape(rootReal, targetLexical);
      targetReal = targetLexical;
    } else {
      throw err;
    }
  }
  const relativeReal = path.relative(rootReal, targetReal);
  if (escapesRoot(relativeReal)) {
    throw new Error('symlink escapes root');
  }
  return { root: rootReal, target: targetReal, relative: relativeReal };
}

/**
 * Walks each component of `targetLexical` and rejects any symlink whose
 * readlink target resolves outside `rootReal`. Used when realpath fails
 * (broken symlinks) so escape attempts cannot hide behind ENOENT.
 */
async function assertNoSymlinkEscape(rootReal, targetLexical) {
  const pending = path.relative(rootReal, targetLexical).split(path.sep).filter(Boolean);
  const seenSymlinks = new Set();
  let current = rootReal;
  let followedLinks = 0;
  while (pending.length > 0) {
    const segment = pending.shift();
    const candidate = path.join(current, segment);
    let stat;
    try {
      stat = await fsp.lstat(candidate);
    } catch (err) {
      if (err.code === 'ENOENT') return; // missing component — let caller surface
      throw err;
    }
    if (stat.isSymbolicLink()) {
      if (seenSymlinks.has(candidate)) {
        throw new Error('symlink chain contains a loop');
      }
      seenSymlinks.add(candidate);
      followedLinks += 1;
      if (followedLinks > 40) {
        throw new Error('symlink chain is too deep');
      }
      const linkTarget = await fsp.readlink(candidate);
      const resolved = path.isAbsolute(linkTarget)
        ? path.resolve(linkTarget)
        : path.resolve(path.dirname(candidate), linkTarget);
      const relative = path.relative(rootReal, resolved);
      if (escapesRoot(relative)) {
        throw new Error('symlink escapes root');
      }
      pending.unshift(...relative.split(path.sep).filter(Boolean));
      current = rootReal;
    } else {
      current = candidate;
    }
  }
}

module.exports = {
  validateRelative,
  resolveWithin,
  canonicalDirectory,
  createRootAccessRegistry,
};
