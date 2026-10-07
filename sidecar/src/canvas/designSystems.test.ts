import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import fs, { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { canvasDir } from '../droidexPaths.js';
import { deferred } from '../testing/canvasStorageSupport.js';
import { CanvasCommandError } from './canvasError.js';
import {
  DESIGN_SYSTEM_LIMITS,
  listDesignSystems,
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
      for (const [fg, bg] of [
        ['accent-fg', 'accent'],
        ['fg', 'elevated'],
        ['fg-muted', 'raised'],
        ['fg', 'active'],
      ]) {
        for (const layer of ['lift', 'press']) {
          const ratio = contrast(
            tokens['--ds-' + fg],
            layerColor(tokens['--ds-' + bg], tokens['--ds-' + layer]),
          );
          assert.ok(
            ratio >= 4.5,
            kit.id + '/' + mode + ' ' + fg + '/' + bg + '+' + layer + ': ' + ratio.toFixed(2),
          );
        }
      }
    }
  }
});

function layerColor(background: string, layer: string): string {
  const parts = /^rgb\((0|255) \1 \1 \/ (0\.\d+)\)$/.exec(layer);
  assert.ok(parts, 'a translucent black or white layer');
  const channel = Number(parts[1]);
  const opacity = Number(parts[2]);
  return (
    '#' +
    [1, 3, 5]
      .map((start) =>
        Math.round(
          parseInt(background.slice(start, start + 2), 16) * (1 - opacity) + channel * opacity,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

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
    assert.equal(error.code, 'version_mismatch');
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

test('a saved version answers a lost-response retry only for the original mutation and content', async () => {
  const kit = userKit('retry-kit');
  const mutationId = 'save-retry-kit';
  const first = await saveDesignSystem(kit, { mutationId });

  assert.deepEqual(await saveDesignSystem(kit, { mutationId }), first);
  await assert.rejects(saveDesignSystem({ ...kit, name: 'Different' }, { mutationId }), {
    code: 'invalid_input',
  });
  await assert.rejects(saveDesignSystem(kit, { mutationId: 'other-save' }), {
    code: 'invalid_input',
  });
  assert.deepEqual(await readDesignSystem(first), kit);
});

test(
  'a save retry refuses a failed directory sync and flushes the whole chain after recovery',
  { skip: process.platform === 'win32' },
  async (t) => {
    const kit = userKit('failed-sync-kit');
    const mutationId = 'save-failed-sync-kit';
    const root = canvasDir();
    const directory = join(root, 'design-systems', kit.id);
    const directories = [dirname(root), root, join(root, 'design-systems'), directory];
    const syncs: string[] = [];
    let failing = true;
    t.mock.method(console, 'error', () => undefined);
    observeDirectorySync(t, (path) => {
      syncs.push(path);
      if (path === directory && failing)
        throw Object.assign(new Error('Injected directory sync failure'), { code: 'EIO' });
    });

    await assert.rejects(saveDesignSystem(kit, { mutationId }), { code: 'storage_failed' });
    assert.deepEqual(await readDesignSystem({ id: kit.id, version: 1, mode: 'light' }), kit);
    syncs.length = 0;
    await assert.rejects(saveDesignSystem(kit, { mutationId }), { code: 'storage_failed' });
    assert.deepEqual(syncs, directories);

    failing = false;
    syncs.length = 0;
    const receipt = await saveDesignSystem(kit, { mutationId });
    assert.deepEqual(receipt, { id: kit.id, version: 1, mode: 'light' });
    assert.deepEqual(syncs, directories);
    assert.deepEqual(await readDesignSystem(receipt), kit);
    assert.deepEqual(await readdir(directory), ['1.json']);
  },
);

test(
  'an overlapping save retry waits for directory durability and returns the same single version',
  { skip: process.platform === 'win32' },
  async (t) => {
    const kit = userKit('pending-sync-kit');
    const mutationId = 'save-pending-sync-kit';
    const directory = join(canvasDir(), 'design-systems', kit.id);
    const firstSync = deferred();
    const retrySync = deferred();
    const release = deferred();
    let syncCount = 0;
    let receiptCount = 0;
    observeDirectorySync(t, async (path) => {
      if (path !== directory) return;
      syncCount += 1;
      if (syncCount === 1) firstSync.resolve();
      else retrySync.resolve();
      await release.promise;
    });
    const first = saveDesignSystem(kit, { mutationId }).then((receipt) => {
      receiptCount += 1;
      return receipt;
    });
    await firstSync.promise;
    const retry = saveDesignSystem(kit, { mutationId }).then((receipt) => {
      receiptCount += 1;
      return receipt;
    });

    try {
      assert.equal(
        await Promise.race([
          retrySync.promise.then(() => 'flushing'),
          retry.then(() => 'acknowledged'),
        ]),
        'flushing',
        'a readable version is not yet a durable receipt',
      );
      assert.equal(receiptCount, 0);
      release.resolve();
      const receipt = { id: kit.id, version: 1, mode: 'light' } as const;
      assert.deepEqual(await Promise.all([first, retry]), [receipt, receipt]);
      assert.deepEqual(await readDesignSystem(receipt), kit);
      assert.deepEqual(await readdir(directory), ['1.json']);
    } finally {
      release.resolve();
      await Promise.allSettled([first, retry]);
    }
  },
);

test('a built-in id cannot be shadowed by a user kit', async () => {
  await assert.rejects(saveDesignSystem(userKit('droidex')), { code: 'preset_read_only' });
});

test('listing returns preset swatches and the latest user version without reading kit content', async () => {
  const kit = userKit('listed-kit');
  await saveDesignSystem(kit);
  await saveDesignSystem({ ...kit, version: 2, name: 'Studio two' });
  const path = join(canvasDir(), 'design-systems', kit.id, '2.json');
  const saved = await readFile(path, 'utf8');
  // Metadata is independently readable even when the executable body is damaged.
  await writeFile(path, saved.slice(0, saved.indexOf('\n') + 1) + '"system": broken}\n');
  const summaries = await listDesignSystems();
  assert.deepEqual(
    summaries.filter((entry) => entry.id === kit.id),
    [
      {
        id: kit.id,
        version: 2,
        name: 'Studio two',
        kind: 'user',
        swatches: {
          light: { surface: '#ffffff', accent: '#1d4ed8' },
          dark: { surface: '#0b0b0c', accent: '#93c5fd' },
        },
      },
    ],
  );
  assert.deepEqual(
    summaries.filter((entry) => entry.kind === 'preset').map((entry) => entry.id),
    ['droidex', 'openai-inspired', 'claude-inspired'],
  );
  assert.ok(summaries.every((entry) => !('files' in entry) && !('guidance' in entry)));
  await assert.rejects(
    readDesignSystem({ id: kit.id, version: 2, mode: 'light' }),
    CanvasCommandError,
  );
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
      'too many files',
      withFiles('crowded-kit', {
        'index.tsx': '',
        ...Object.fromEntries(
          Array.from({ length: CANVAS_LIMITS.maxSourceFilesPerDesign }, (_, index) => [
            `file-${index}.tsx`,
            '',
          ]),
        ),
      }),
    ],
    [
      'too much total source',
      withFiles(
        'heavy-kit',
        Object.fromEntries(
          ['index.tsx', 'a.tsx', 'b.tsx', 'c.tsx', 'd.tsx'].map((path) => [
            path,
            'x'.repeat(CANVAS_LIMITS.maxFileBytes),
          ]),
        ),
      ),
    ],
    [
      'an invalid custom property name',
      {
        ...userKit('malformed-token-kit'),
        modes: { light: { '--ds_Accent': '#000' }, dark: { '--ds_Accent': '#fff' } },
      },
    ],
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

function observeDirectorySync(
  t: TestContext,
  observe: (path: string) => void | Promise<void>,
): void {
  const open = fs.open;
  const mockedOpen = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    const file = await open(...args);
    const [path, flags] = args;
    if (typeof path === 'string' && flags === constants.O_RDONLY) {
      const sync = file.sync.bind(file);
      t.mock.method(file, 'sync', async () => {
        await observe(path);
        await sync();
      });
    }
    return file;
  });
  syncBuiltinESMExports();
  t.after(() => {
    mockedOpen.mock.restore();
    syncBuiltinESMExports();
  });
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
