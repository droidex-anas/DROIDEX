import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanvasCommandError } from './canvasError.js';
import {
  DESIGN_SYSTEM_LIMITS,
  readDesignSystem,
  saveDesignSystem,
  type DesignSystem,
} from './designSystems.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';

test('the built-in kit reads back exactly as it ships', async () => {
  const system = await readDesignSystem({ id: 'droidex', version: 1, mode: 'light' });

  assert.deepEqual(system, DROIDEX_DESIGN_SYSTEM);
  assert.ok(system.files['index.tsx'], 'the kit exports its primitives from index.tsx');
  assert.ok(system.examples['Hey.tsx'], 'the kit ships a starter example');
  assert.ok(system.modes.light['--ds-accent'] && system.modes.dark['--ds-accent']);
});

test('a version that was never written is not available', async () => {
  await assert.rejects(readDesignSystem({ id: 'droidex', version: 2, mode: 'light' }), (error) => {
    assert.ok(error instanceof CanvasCommandError);
    assert.equal(error.code, 'invalid_input');
    return true;
  });
});

test('a saved kit reads back as it was written', async () => {
  const kit = userKit('saved-kit');

  const ref = await saveDesignSystem(kit);

  assert.deepEqual(ref, { id: 'saved-kit', version: 1, mode: 'light' });
  assert.deepEqual(await readDesignSystem({ ...ref, mode: 'dark' }), kit);
});

test('a published version never changes', async () => {
  const kit = userKit('immutable-kit');
  await saveDesignSystem(kit);

  await assert.rejects(
    saveDesignSystem({ ...kit, name: 'Rewritten', guidance: 'Different guidance.' }),
    (error) => {
      assert.ok(error instanceof CanvasCommandError);
      assert.equal(error.code, 'invalid_input');
      return true;
    },
  );
  assert.equal(
    (await readDesignSystem({ id: 'immutable-kit', version: 1, mode: 'light' })).name,
    kit.name,
  );

  // The next version is how a kit changes.
  await saveDesignSystem({ ...kit, version: 2, name: 'Second' });
  assert.equal(
    (await readDesignSystem({ id: 'immutable-kit', version: 2, mode: 'light' })).name,
    'Second',
  );
});

test('a built-in id cannot be shadowed by a user kit', async () => {
  await assert.rejects(saveDesignSystem(userKit('droidex')), CanvasCommandError);
});

test('oversized guidance is refused', async () => {
  const guidance = 'g'.repeat(DESIGN_SYSTEM_LIMITS.maxGuidanceBytes + 1);

  await assert.rejects(saveDesignSystem({ ...userKit('wordy-kit'), guidance }), (error) => {
    assert.ok(error instanceof CanvasCommandError);
    assert.match(error.message, /16 KiB/);
    return true;
  });
});

test('an unusable kit is refused before anything is written', async () => {
  const refusals: [string, DesignSystem][] = [
    ['an escaping path', withFiles('escape-kit', { '../outside.tsx': 'export const a = 1;\n' })],
    ['a missing entry', withFiles('entryless-kit', { 'button.tsx': 'export const a = 1;\n' })],
    [
      'a token value that closes its rule',
      {
        ...userKit('injected-kit'),
        modes: {
          light: { '--ds-accent': '#000; } body { display: none' },
          dark: { '--ds-accent': '#fff' },
        },
      },
    ],
    [
      'a token name that is not a custom property',
      {
        ...userKit('named-kit'),
        modes: { light: { accent: '#000' }, dark: { '--ds-accent': '#fff' } },
      },
    ],
  ];

  for (const [reason, kit] of refusals) {
    await assert.rejects(saveDesignSystem(kit), CanvasCommandError, reason);
    await assert.rejects(
      readDesignSystem({ id: kit.id, version: 1, mode: 'light' }),
      CanvasCommandError,
      reason,
    );
  }
});

function userKit(id: string): DesignSystem {
  return {
    id,
    version: 1,
    name: 'Studio',
    modes: {
      light: { '--ds-canvas': '#ffffff', '--ds-accent': '#1d4ed8' },
      dark: { '--ds-canvas': '#0b0b0c', '--ds-accent': '#93c5fd' },
    },
    files: {
      'index.tsx': `export function Panel({ children }: { children: unknown }) {
  return <div className="p-4">{children as never}</div>;
}
`,
    },
    guidance: 'Use the panel for every grouped block.',
    examples: { 'Panel.tsx': 'export default function Example() {\n  return <p>hey</p>;\n}\n' },
  };
}

function withFiles(id: string, files: Record<string, string>): DesignSystem {
  return { ...userKit(id), files };
}
