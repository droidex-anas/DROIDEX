import assert from 'node:assert/strict';
import { mkdirSync, symlinkSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeFolderInside } from './projectPaths.js';

test('a folder made by someone else mid-walk is used, and a link made there is refused', async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'project-paths-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outside = join(root, 'outside');
  const project = join(root, 'project');
  await mkdir(outside);
  await mkdir(project);

  // A checkpoint runs once the walk has found a folder missing, just before it makes it.
  let checkpoints = 0;
  const made = await makeFolderInside(project, 'design/hey', 'design/hey', () => {
    if (checkpoints++ === 0) mkdirSync(join(project, 'design'));
  });
  assert.equal(made, join(project, 'design', 'hey'));

  await assert.rejects(
    makeFolderInside(project, 'linked/hey', 'linked/hey', () => {
      symlinkSync(outside, join(project, 'linked'));
    }),
    { code: 'invalid_input', message: /goes through a symbolic link/ },
  );
});
