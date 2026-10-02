import test from 'node:test';
import assert from 'node:assert/strict';
import { compactPath, displayPath, relativeWorkspaceFilePath } from './pathDisplay';

test('relativeWorkspaceFilePath joins relative review paths to the session folder', () => {
  assert.equal(relativeWorkspaceFilePath('src/app.ts', '/repo'), 'src/app.ts');
  assert.equal(relativeWorkspaceFilePath('./src/app.ts', '/repo'), 'src/app.ts');
});

test('workspace previews reject paths outside their root', () => {
  for (const file of [
    '../shared/foo.ts',
    '/repository/file.ts',
    '/etc/passwd',
    'src/../../outside.ts',
  ]) {
    assert.throws(() => relativeWorkspaceFilePath(file, '/repo'), /outside/);
  }
  assert.throws(() => relativeWorkspaceFilePath('file.ts', ''), /required/);
});

test('workspace previews accept absolute descendants and root folders', () => {
  assert.equal(relativeWorkspaceFilePath('/repo/src/app.ts', '/repo'), 'src/app.ts');
  assert.equal(relativeWorkspaceFilePath('etc/hosts', '/'), 'etc/hosts');
  assert.equal(relativeWorkspaceFilePath('C:/Repo/src/app.ts', 'c:/repo'), 'src/app.ts');
  // Whitespace in directory and file names is preserved.
  assert.equal(relativeWorkspaceFilePath('/repo / file ', '/repo '), ' file ');
  assert.equal(relativeWorkspaceFilePath(' file ', '/repo '), ' file ');
});

test('displayPath relativizes descendants of the session folder, including filesystem roots', () => {
  assert.equal(displayPath('/etc/hosts', '/'), 'etc/hosts');
  assert.equal(displayPath('/', '/'), '.');
  assert.equal(displayPath('C:/Windows/System32', 'C:/'), 'Windows/System32');
  // Drive-letter case names the same session folder.
  assert.equal(displayPath('C:/Repo/src/app.ts', 'c:/repo'), 'src/app.ts');
  assert.equal(displayPath('c:/repo', 'C:/Repo'), '.');
  // A sibling directory that shares the prefix is not a descendant.
  assert.equal(displayPath('/repository/src/app.ts', '/repo'), 'repository/src/app.ts');
});

test('compactPath shortens long relative read paths', () => {
  assert.equal(compactPath('src/a/b/c/d.ts'), '…/b/c/d.ts');
  assert.equal(compactPath('src/app.ts'), 'src/app.ts');
});
