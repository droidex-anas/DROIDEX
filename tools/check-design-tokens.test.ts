import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

const checker = fileURLToPath(new URL('./check-design-tokens.mjs', import.meta.url));

// Two arbitrary-value violations; the exempt icon file adds one more that must
// never be counted.
const CASE_SOURCE = 'export function Case() {\n  return <div className="text-[12.5px] p-[7px]" />;\n}\n';
const ICON_SOURCE = 'export function ModelIcon() {\n  return <div className="text-[10px]" />;\n}\n';

function createFixture(t: TestContext, baseline: Record<string, Record<string, number>>) {
  const root = mkdtempSync(join(tmpdir(), 'droidex-design-tokens-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/components'), { recursive: true });
  mkdirSync(join(root, 'tools'), { recursive: true });
  writeFileSync(join(root, 'src/components/Case.tsx'), CASE_SOURCE);
  writeFileSync(join(root, 'src/components/ModelIcon.tsx'), ICON_SOURCE);
  writeFileSync(join(root, 'tools/design-token-baseline.json'), JSON.stringify(baseline, null, 2) + '\n');
  return {
    root,
    run: (...args: string[]) =>
      spawnSync(process.execPath, [checker, '--root', root, ...args], { encoding: 'utf8' }),
  };
}

test('a rise fails with the file, category and delta', (t) => {
  const { run } = createFixture(t, { 'src/components/Case.tsx': { 'arbitrary-value': 1 } });
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /may only decrease/);
  assert.match(result.stderr, /src\/components\/Case\.tsx: arbitrary-value 1 → 2 \(\+1\)/);
  assert.doesNotMatch(result.stderr, /ModelIcon/);
});

test('a fall fails until the baseline is lowered', (t) => {
  const { run } = createFixture(t, { 'src/components/Case.tsx': { 'arbitrary-value': 3 } });
  const result = run();
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /baseline is stale/);
  assert.match(result.stderr, /arbitrary-value 3 → 2 \(-1\)/);
  assert.match(result.stderr, /--update-baseline/);
});

test('--update-baseline rewrites the counts, and the exempt icon file stays uncounted', (t) => {
  const { run, root } = createFixture(t, { 'src/components/Case.tsx': { 'arbitrary-value': 3 } });
  const update = run('--update-baseline');
  assert.equal(update.status, 0, update.stdout + update.stderr);
  const baselinePath = join(root, 'tools/design-token-baseline.json');
  assert.deepEqual(JSON.parse(readFileSync(baselinePath, 'utf8')), {
    'src/components/Case.tsx': { 'arbitrary-value': 2 },
  });
  const current = run();
  assert.equal(current.status, 0, current.stdout + current.stderr);
  assert.match(current.stdout, /arbitrary-value 2/);
});
