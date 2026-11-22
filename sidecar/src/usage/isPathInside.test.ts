import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import { isPathInside } from './isPathInside.js';

test('accepts only strict descendants after resolving path segments', () => {
  const root = resolve('/a/b');
  assert.equal(isPathInside(root, resolve(root, 'nested/file.json')), true);
  assert.equal(isPathInside(root, resolve(root, '..foo/bar')), true);
  assert.equal(isPathInside(root, root), false);
  assert.equal(isPathInside(root, resolve('/a/bc/file.json')), false);
  assert.equal(isPathInside(root, `${root}/../escape.json`), false);
  assert.equal(isPathInside(root, resolve(root, '..')), false);
  assert.equal(isPathInside(root, resolve('/unrelated/file.json')), false);
});
