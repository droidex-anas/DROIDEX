import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { formatDesignPrompt, writeDesignPromptPack } from './designPromptPacks.js';

test('a design pack is stored as JSON on disk, and the prompt points at it', async (t) => {
  const baseDir = join(tmpdir(), `droid-pack-test-${String(Date.now())}`);
  t.after(() => rm(baseDir, { recursive: true, force: true }));
  const references = [
    {
      id: 'ref-one',
      anchor: {
        id: 'ref-one',
        kind: 'region' as const,
        label: 'region',
        box: { x: 10, y: 10, width: 40, height: 40 },
        screenshotPath: '/tmp/shot.png',
      },
      url: 'http://127.0.0.1:1420/',
      viewport: { width: 900, height: 700, deviceScaleFactor: 1 },
      scroll: { x: 0, y: 0 },
      createdAt: '2026-06-06T12:00:00.000Z',
    },
  ];
  const { pack, path } = await writeDesignPromptPack({
    baseDir,
    appSessionId: 'app-session-one',
    browserSessionId: 'browser-one',
    instruction: 'Remove this dot pattern',
    now: () => new Date('2026-06-06T12:00:00.000Z'),
    references,
  });

  assert.equal(pack.createdAt, '2026-06-06T12:00:00.000Z');
  assert.match(path, /app-session-one\/pack-2026-06-06T12-00-00-000Z\.json$/);
  const saved = JSON.parse(await readFile(path, 'utf8')) as { instruction: string };
  assert.equal(saved.instruction, 'Remove this dot pattern');

  const text = formatDesignPrompt(path, 'Make this cleaner', references);
  assert.ok(text.startsWith('Design Mode reference pack:'));
  assert.ok(text.includes(`References JSON: ${path}`));
  assert.match(text, /User instruction:\nMake this cleaner/);
  assert.match(text, /Avoid AI slop/);
  assert.match(text, /do not modify backend/i);
});
