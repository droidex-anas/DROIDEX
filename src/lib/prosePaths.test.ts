import assert from 'node:assert/strict';
import test from 'node:test';
import { repoPathInProse } from './prosePaths';

test('repoPathInProse claims file mentions and drops the line suffix', () => {
  assert.equal(repoPathInProse('docs/architecture.md'), 'docs/architecture.md');
  assert.equal(repoPathInProse('package.json'), 'package.json');
  assert.equal(repoPathInProse('src/components/ChatView.tsx:42'), 'src/components/ChatView.tsx');
  assert.equal(repoPathInProse(' src/lib/diff.ts:12:3 '), 'src/lib/diff.ts');
  assert.equal(repoPathInProse('src/components/transcript'), 'src/components/transcript');
});

test('repoPathInProse leaves ordinary inline code alone', () => {
  assert.equal(repoPathInProse('npm ci'), null);
  assert.equal(repoPathInProse('useState'), null);
  assert.equal(repoPathInProse('either/or'), null);
  assert.equal(repoPathInProse('src/**/*.ts'), null);
  assert.equal(repoPathInProse('https://example.com/a.md'), null);
  assert.equal(repoPathInProse('--no-verify'), null);
  assert.equal(repoPathInProse('src/lib/'), null);
  assert.equal(repoPathInProse('open(path)'), null);
  assert.equal(repoPathInProse('/usr/bin/node'), null);
  assert.equal(repoPathInProse('/Users/me/repo/src/app.ts'), '/Users/me/repo/src/app.ts');
});

test('repoPathInProse claims files whose whole name identifies them', () => {
  assert.equal(repoPathInProse('Dockerfile'), 'Dockerfile');
  assert.equal(repoPathInProse('.gitignore'), '.gitignore');
  assert.equal(repoPathInProse('src/Dockerfile'), 'src/Dockerfile');
  assert.equal(repoPathInProse('profile'), null);
});

test('repoPathInProse reads Windows mentions as paths', () => {
  assert.equal(repoPathInProse('src\\components\\App.tsx'), 'src/components/App.tsx');
  assert.equal(repoPathInProse('C:\\Users\\me\\app.ts'), 'C:/Users/me/app.ts');
  assert.equal(repoPathInProse('src/lib/a.ts:12:3'), 'src/lib/a.ts');
});

test('repoPathInProse allows a space only inside a file name', () => {
  assert.equal(repoPathInProse('src/My Component.tsx'), 'src/My Component.tsx');
  assert.equal(repoPathInProse('git add src/lib/a.ts'), null);
  assert.equal(repoPathInProse('see README.md'), null);
  assert.equal(repoPathInProse('src/a.ts and src/b.ts'), null);
});
