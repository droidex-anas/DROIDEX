const test = require('node:test');
const assert = require('node:assert');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  createRootAccessRegistry,
  validateRelative,
  resolveWithin,
} = require('./filesPathSecurity.cjs');

let root;
let rootReal;
let outside;

test.before(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'files-security-root-'));
  rootReal = await fsp.realpath(root);
  outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'files-security-outside-'));
  await fsp.mkdir(path.join(root, 'sub'));
  await fsp.writeFile(path.join(root, '..notes.txt'), 'valid dotted name\n');
  await fsp.writeFile(path.join(root, 'sub', 'nested.txt'), 'nested\n');
});

test.after(async () => {
  await Promise.all([
    fsp.rm(root, { recursive: true, force: true }),
    fsp.rm(outside, { recursive: true, force: true }),
  ]);
});

test('validateRelative rejects non-strings, absolute paths, control chars, and traversal', () => {
  assert.ok(validateRelative(root, '').target === path.resolve(root));
  assert.throws(() => validateRelative(123, ''), /rootDir must be a string/);
  assert.throws(() => validateRelative(root, 42), /must be a string/);
  assert.throws(() => validateRelative(root, '/etc/passwd'), /absolute path rejected/);
  assert.throws(() => validateRelative(root, 'a\0b'), /invalid characters/);
  assert.throws(() => validateRelative(root, '../escape'), /escapes root/);
  assert.throws(() => validateRelative(root, 'sub/../../escape'), /escapes root/);
  // A single `..` that lands back inside root is fine.
  const ok = validateRelative(root, 'sub/../alpha.md');
  assert.equal(path.relative(path.resolve(root), ok.target), 'alpha.md');
});

test('paths beginning with two dots remain valid inside the root', async () => {
  const validated = validateRelative(root, '..notes.txt');
  assert.equal(validated.relative, '..notes.txt');
  const resolved = await resolveWithin(root, '..notes.txt');
  assert.equal(resolved.relative, '..notes.txt');
});

test('resolveWithin rejects symlinks that escape the root', async () => {
  const linkPath = path.join(root, 'escape-link');
  await fsp.symlink(outside, linkPath, 'dir');
  await assert.rejects(() => resolveWithin(root, 'escape-link'), /escapes root/);
});

test('resolveWithin allows symlinks whose target stays inside the root', async () => {
  const innerLink = path.join(root, 'inner-link');
  await fsp.symlink(path.join(root, 'sub'), innerLink, 'dir');
  const resolved = await resolveWithin(root, 'inner-link/nested.txt');
  assert.equal(path.basename(resolved.target), 'nested.txt');
});

test('resolveWithin rejects chained dangling symlinks that escape the root', async () => {
  const outerLink = path.join(root, 'outer-link');
  const innerLink = path.join(root, 'inner-escape-link');
  await fsp.symlink(path.join(outside, 'missing.txt'), outerLink, 'file');
  await fsp.symlink(outerLink, innerLink, 'file');
  await assert.rejects(() => resolveWithin(root, 'inner-escape-link'), /escapes root/);
});

test('root access registry resolves only opaque tokens for authorized canonical roots', async () => {
  const registry = createRootAccessRegistry({
    createToken: () => 'test-files-token-0000000000000001',
  });
  const token = await registry.authorize(root);

  assert.equal(registry.resolve(token), rootReal);
  assert.equal(await registry.tokenFor(root), token);
  await assert.rejects(() => registry.authorize(''), /rootDir is required/);
  assert.throws(() => registry.resolve(root), { code: 'EACCES' });
  assert.throws(() => registry.resolve('/'), { code: 'EACCES' });
  registry.clear();
  assert.throws(() => registry.resolve(token), { code: 'EACCES' });
});
