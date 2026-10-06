import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { canvasDir } from '../droidexPaths.js';
import { CanvasCommandError } from './canvasError.js';
import {
  DESIGN_SYSTEM_LIMITS,
  readDesignSystem,
  saveDesignSystem,
  type DesignSystem,
} from './designSystems.js';
import { CANVAS_LIMITS } from './schema.js';
import { OPENAI_INSPIRED_DESIGN_SYSTEM } from './presets/openai-inspired.js';
import { CLAUDE_INSPIRED_DESIGN_SYSTEM } from './presets/claude-inspired.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';

const KITS = [DROIDEX_DESIGN_SYSTEM, OPENAI_INSPIRED_DESIGN_SYSTEM, CLAUDE_INSPIRED_DESIGN_SYSTEM];

test('built-in versions are exact snapshots that callers cannot mutate', async () => {
  for (const kit of KITS) {
    const ref = { id: kit.id, version: kit.version, mode: 'light' as const };
    const system = await readDesignSystem(ref);
    assert.deepEqual(system, kit);
    system.modes.light['--ds-accent'] = '#000000';
    system.files['index.tsx'] = '';
    system.examples['Hey.tsx'] = '';
    system.name = 'Changed';
    assert.deepEqual(await readDesignSystem(ref), kit);
    await assert.rejects(saveDesignSystem({ ...kit, version: 2 }), CanvasCommandError);
    // The same validation used for custom versions applies to complete kit files.
    await saveDesignSystem({ ...kit, id: 'validated-' + kit.id });
  }
});

test('kit text meets AA contrast on every surface the primitives use', () => {
  for (const kit of KITS) {
    for (const [mode, tokens] of Object.entries(kit.modes)) {
      const pairs = [
        ...['canvas', 'surface', 'raised', 'elevated', 'active', 'accent-soft'].map((bg) => [
          'fg',
          bg,
        ]),
        ...['canvas', 'surface', 'raised', 'elevated', 'active'].map((bg) => ['fg-muted', bg]),
        ['accent-fg', 'accent'],
        ['accent-fg', 'accent-strong'],
        ['danger', 'raised'],
      ];
      for (const [fg, bg] of pairs) {
        const foreground = tokens['--ds-' + fg];
        const background = tokens['--ds-' + bg];
        assert.ok(foreground && background, kit.id + ' has ' + fg + '/' + bg);
        const ratio = contrast(foreground, background);
        assert.ok(
          ratio >= 4.5,
          kit.id + '/' + mode + ' ' + fg + '/' + bg + ': ' + ratio.toFixed(2),
        );
      }
    }
  }
});

function contrast(foreground: string, background: string): number {
  function luminance(hex: string): number {
    assert.match(hex, /^#[0-9a-f]{6}$/i);
    const [r, g, b] = [1, 3, 5].map((start) => {
      const channel = parseInt(hex.slice(start, start + 2), 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const a = luminance(foreground),
    b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

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
    [
      'a missing dark counterpart',
      {
        ...userKit('unpaired-kit'),
        modes: { light: { '--ds-canvas': '#ffffff' }, dark: {} },
      },
    ],
    [
      'an oversized kit file',
      withFiles('large-kit', { 'index.tsx': 'x'.repeat(CANVAS_LIMITS.maxFileBytes + 1) }),
    ],
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

test('concurrent saves of one version publish exactly one of them', async () => {
  const kit = userKit('contested-kit');
  const rival = { ...kit, name: 'Rival' };

  const outcomes = await Promise.allSettled([saveDesignSystem(kit), saveDesignSystem(rival)]);

  const saved = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(saved.length, 1, 'one writer publishes');
  assert.equal(refused.length, 1, 'the other is told the version exists');
  assert.ok(refused[0]?.status === 'rejected' && refused[0].reason instanceof CanvasCommandError);
  assert.equal((refused[0] as PromiseRejectedResult).reason.code, 'invalid_input');

  // Whichever won, the stored kit is one of the two intact, never a blend.
  const stored = await readDesignSystem({ id: 'contested-kit', version: 1, mode: 'light' });
  assert.ok(stored.name === kit.name || stored.name === rival.name);
});

test('concurrent saves of different versions both publish', async () => {
  const kit = userKit('busy-kit');

  await Promise.all([
    saveDesignSystem(kit),
    saveDesignSystem({ ...kit, version: 2 }),
    saveDesignSystem({ ...kit, version: 3 }),
  ]);

  for (const version of [1, 2, 3]) {
    assert.equal(
      (await readDesignSystem({ id: 'busy-kit', version, mode: 'light' })).version,
      version,
    );
  }
});

test('a linked kit directory is refused instead of followed', async (t) => {
  const outside = await scratchDirectory(t);
  const linked = join(canvasDir(), 'design-systems', 'linked-kit');
  await mkdir(join(canvasDir(), 'design-systems'), { recursive: true });
  await symlink(outside, linked, 'dir');
  t.after(() => rm(linked, { force: true }));

  await assert.rejects(saveDesignSystem(userKit('linked-kit')), (error) => {
    assert.ok(error instanceof CanvasCommandError);
    assert.equal(error.code, 'storage_failed');
    return true;
  });
  await assert.rejects(
    readDesignSystem({ id: 'linked-kit', version: 1, mode: 'light' }),
    CanvasCommandError,
  );
  assert.deepEqual(await readdir(outside), [], 'nothing was written through the link');
});

async function scratchDirectory(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-canvas-kit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

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
