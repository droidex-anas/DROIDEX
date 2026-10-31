import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import fs, { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { canvasDir } from '../droidexPaths.js';
import { deferred, pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { CanvasCommandError } from './canvasError.js';
import { CompilerWorker } from './compiler.js';
import { buildDocument, type DocumentPart } from './buildDocument.js';
import { kitModes } from './designSystemDocument.js';
import {
  DESIGN_SYSTEM_LIMITS,
  designSystemSchema,
  listDesignSystems,
  listDesignSystemVersions,
  readDesignSystem,
  saveDesignSystem,
  setDesignSystemDeleted,
  type DesignSystem,
  type SavedBy,
} from './designSystems.js';
import { CANVAS_LIMITS } from './schema.js';
import { OPENAI_INSPIRED_DESIGN_SYSTEM } from './presets/openai-inspired.js';
import { CLAUDE_INSPIRED_DESIGN_SYSTEM } from './presets/claude-inspired.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';

pinScratchProfile();

const KITS = [DROIDEX_DESIGN_SYSTEM, OPENAI_INSPIRED_DESIGN_SYSTEM, CLAUDE_INSPIRED_DESIGN_SYSTEM];

test('built-in versions are exact snapshots that callers cannot mutate', async () => {
  for (const kit of KITS) {
    const ref = { id: kit.id, version: kit.version, mode: 'light' as const };
    const system = await readDesignSystem(ref);
    assert.deepEqual(system, kit);
    system.sections.length = 0;
    system.files['index.tsx'] = '';
    system.examples['cover.tsx'] = '';
    system.name = 'Changed';
    assert.deepEqual(await readDesignSystem(ref), kit);
    await assert.rejects(save({ ...kit, version: kit.version + 1 }), {
      code: 'preset_read_only',
    });
    // The same validation used for custom versions applies to complete kit files.
    await save({ ...kit, id: 'validated-' + kit.id, version: 1 });
  }
});

test('kit text meets AA contrast on every surface the primitives use', () => {
  for (const kit of KITS) {
    for (const [mode, tokens] of Object.entries(kitModes(kit.sections))) {
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

  const ref = await save(kit);

  assert.deepEqual(ref, { id: 'saved-kit', version: 1, mode: 'light' });
  assert.deepEqual(await readDesignSystem({ ...ref, mode: 'dark' }), kit);
});

test('a save onto a version that is no longer the latest names the latest and writes nothing', async () => {
  const kit = userKit('stale-kit');
  await save(kit);
  await save({ ...kit, version: 2, name: 'Second' });

  await assert.rejects(
    save({ ...kit, version: 2, name: 'Late' }, { mutationId: 'late' }),
    (error) => {
      assert.ok(error instanceof CanvasCommandError);
      assert.equal(error.code, 'revision_conflict');
      assert.equal(error.latestVersion, 2);
      return true;
    },
  );
  const directory = join(canvasDir(), 'design-systems', kit.id);
  assert.deepEqual((await readdir(directory)).sort(), ['1.json', '2.json']);
  assert.equal((await readDesignSystem({ id: kit.id, version: 2, mode: 'light' })).name, 'Second');
});

test('a saved version answers a lost-response retry only for the original mutation and content', async () => {
  const kit = userKit('retry-kit');
  const mutationId = 'save-retry-kit';
  const first = await save(kit, { mutationId });

  assert.deepEqual(await save(kit, { mutationId }), first);
  await assert.rejects(save({ ...kit, name: 'Different' }, { mutationId }), {
    code: 'revision_conflict',
  });
  await assert.rejects(save(kit, { mutationId: 'other-save' }), {
    code: 'revision_conflict',
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

    await assert.rejects(save(kit, { mutationId }), { code: 'storage_failed' });
    assert.deepEqual(await readDesignSystem({ id: kit.id, version: 1, mode: 'light' }), kit);
    syncs.length = 0;
    await assert.rejects(save(kit, { mutationId }), { code: 'storage_failed' });
    assert.deepEqual(syncs, directories);

    failing = false;
    syncs.length = 0;
    const receipt = await save(kit, { mutationId });
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
    const first = save(kit, { mutationId }).then((receipt) => {
      receiptCount += 1;
      return receipt;
    });
    await firstSync.promise;
    const retry = save(kit, { mutationId }).then((receipt) => {
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
  await assert.rejects(save(userKit('droidex')), { code: 'preset_read_only' });
});

test('listing returns preset swatches and the latest user version without reading kit content', async () => {
  const kit = userKit('listed-kit');
  await save(kit);
  await save({ ...kit, version: 2, name: 'Studio two' });
  const path = join(canvasDir(), 'design-systems', kit.id, '2.json');
  const saved = await readFile(path, 'utf8');
  // Metadata is independently readable even when the executable body is damaged.
  await writeFile(path, saved.slice(0, saved.indexOf('\n') + 1) + '"system": broken}\n');
  const summaries = await listDesignSystems();
  const listed = summaries.filter((entry) => entry.id === kit.id);
  assert.match(listed[0]?.savedAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(
    listed.map((entry) => ({ ...entry, savedAt: null })),
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
        cover: false,
        savedAt: null,
        proposal: false,
      },
    ],
  );
  assert.deepEqual(
    summaries.filter((entry) => entry.kind === 'preset').map((entry) => entry.id),
    ['droidex', 'openai-inspired', 'claude-inspired'],
  );
  // Auto leads the list as its own kind, so no preset reads as the default.
  assert.deepEqual([summaries[0].id, summaries[0].kind], ['auto', 'auto']);
  assert.ok(summaries.every((entry) => !('files' in entry) && !('sections' in entry)));
  await assert.rejects(
    readDesignSystem({ id: kit.id, version: 2, mode: 'light' }),
    CanvasCommandError,
  );
});

test('listing leaves out a kit with a damaged header and keeps every other kit', async (t) => {
  const warn = t.mock.method(console, 'warn', () => undefined);
  await save(userKit('readable-kit'));
  const damaged = join(canvasDir(), 'design-systems', 'damaged-kit');
  await mkdir(damaged, { recursive: true });
  await writeFile(join(damaged, '1.json'), JSON.stringify(userKit('damaged-kit')) + '\n');

  const ids = (await listDesignSystems()).map((entry) => entry.id);

  assert.deepEqual(ids.slice(0, 4), ['auto', 'droidex', 'openai-inspired', 'claude-inspired']);
  assert.ok(ids.includes('readable-kit'));
  assert.ok(!ids.includes('damaged-kit'));
  assert.equal(warn.mock.callCount(), 1);
  assert.match(String(warn.mock.calls[0]?.arguments[0]), /damaged-kit version 1/);
});

test('a document whose text is over 16 KiB is refused, naming its longest note', async () => {
  const notes: DocumentPart[] = ['a', 'b', 'c'].map((name, index) => ({
    kind: 'note',
    label: `${name}.md`,
    body: 'g'.repeat(5000 + index * 1000),
  }));

  await assert.rejects(save(userKit('wordy-kit', notes)), (error) => {
    assert.ok(error instanceof CanvasCommandError);
    assert.match(error.message, /16 KiB.*c\.md/);
    return true;
  });
});

test('an unusable kit is refused before anything is written', async () => {
  const refusals: [string, DesignSystem][] = [
    ['a preview of a missing example', { ...userKit('previewless-kit'), examples: {} }],
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
      withTokens('malformed-token-kit', { '--ds_Accent': '#000' }, { '--ds_Accent': '#fff' }),
    ],
    [
      'a token value that closes its rule',
      withTokens(
        'injected-kit',
        { '--ds-accent': '#000; } body { display: none' },
        { '--ds-accent': '#fff' },
      ),
    ],
    [
      'a token name that is not a custom property',
      withTokens('named-kit', { accent: '#000' }, { accent: '#fff' }),
    ],
  ];

  for (const [reason, kit] of refusals) {
    await assert.rejects(save(kit), CanvasCommandError, reason);
    await assert.rejects(
      readDesignSystem({ id: kit.id, version: 1, mode: 'light' }),
      CanvasCommandError,
      reason,
    );
  }
});

test('concurrent saves onto one base publish exactly one of them', async () => {
  const kit = userKit('contested-kit');
  const rival = { ...kit, name: 'Rival' };

  const outcomes = await Promise.allSettled([
    save(kit, { mutationId: 'first' }),
    save(rival, { mutationId: 'rival' }),
  ]);

  const saved = outcomes.filter((outcome) => outcome.status === 'fulfilled');
  const refused = outcomes.filter((outcome) => outcome.status === 'rejected');
  assert.equal(saved.length, 1, 'one writer publishes');
  assert.equal(refused.length, 1, 'the other is told its base is stale');
  const reason: unknown = refused[0]?.reason;
  assert.ok(reason instanceof CanvasCommandError);
  assert.equal(reason.code, 'revision_conflict');
  assert.equal(reason.latestVersion, 1);

  // Whichever won, the stored kit is one of the two intact, never a blend.
  const stored = await readDesignSystem({ id: 'contested-kit', version: 1, mode: 'light' });
  assert.ok(stored.name === kit.name || stored.name === rival.name);
});

test("each note a save changes becomes its saver's, and the history lists who saved", async () => {
  const agent: SavedBy = { actor: 'agent', appSessionId: 'app-1' };
  const spacing: DocumentPart = { kind: 'note', label: 'spacing.md', body: 'Keep gaps even.' };
  const kit = userKit('authored-kit');
  await save(kit);
  await save({ ...userKit(kit.id, [PANEL_NOTE, spacing]), version: 2 }, { savedBy: agent });
  const edited = { ...PANEL_NOTE, body: 'Group related controls in a panel.' };
  await save({ ...userKit(kit.id, [edited, spacing]), version: 3 });

  const authors = async (version: number) =>
    (await readDesignSystem({ id: kit.id, version, mode: 'light' })).sections.flatMap((section) =>
      section.items.flatMap((item) => (item.kind === 'note' ? [[item.label, item.author]] : [])),
    );
  assert.deepEqual(await authors(2), [
    ['panel.md', 'user'],
    ['spacing.md', 'agent'],
  ]);
  assert.deepEqual(await authors(3), [
    ['panel.md', 'user'],
    ['spacing.md', 'agent'],
  ]);
  assert.deepEqual(
    (await listDesignSystemVersions(kit.id)).map(({ version, savedBy }) => [version, savedBy]),
    [
      [3, { actor: 'user' }],
      [2, agent],
      [1, { actor: 'user' }],
    ],
  );
});

test('a deleted kit leaves the list but stays readable, and restoring it lists it again', async (t) => {
  const kit = userKit('deleted-kit');
  const ref = await save(kit);
  const isListed = async () => (await listDesignSystems()).some((entry) => entry.id === kit.id);

  await setDesignSystemDeleted(kit.id, true, 'delete-once');
  assert.equal(await isListed(), false);
  assert.deepEqual(await readDesignSystem(ref), kit);
  await assert.rejects(save({ ...kit, version: 2 }), { code: 'invalid_input' });

  await setDesignSystemDeleted(kit.id, false, 'undo-once');
  assert.equal(await isListed(), true);
  // A delete whose answer was lost and is retried after its Undo is not applied again.
  await setDesignSystemDeleted(kit.id, true, 'delete-once');
  assert.equal(await isListed(), true);

  // A duplicate that overlaps its delete waits for it, so it cannot land after the Undo.
  const tombstone = join(canvasDir(), 'design-systems', kit.id, 'deleted');
  const releaseDuplicate = deferred();
  let tombstoneOpens = 0;
  const open = fs.open;
  const mockedOpen = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    if (args[0] === tombstone && ++tombstoneOpens === 2) await releaseDuplicate.promise;
    return open(...args);
  });
  syncBuiltinESMExports();
  t.after(() => {
    mockedOpen.mock.restore();
    syncBuiltinESMExports();
  });
  const first = setDesignSystemDeleted(kit.id, true, 'delete-twice');
  const duplicate = setDesignSystemDeleted(kit.id, true, 'delete-twice');
  await first;
  await setDesignSystemDeleted(kit.id, false, 'undo-twice');
  releaseDuplicate.resolve();
  await duplicate;
  assert.equal(await isListed(), true);
});

test('a v1.6 version at its old limits reads as a valid document, builds, and saves on as one', async (t) => {
  const directory = join(canvasDir(), 'design-systems', 'legacy-kit');
  await mkdir(directory, { recursive: true });
  const modes = {
    light: { '--ds-canvas': '#ffffff', '--ds-accent': '#1d4ed8', '--brand-ink': '#111111' },
    dark: { '--ds-canvas': '#0b0b0c', '--ds-accent': '#93c5fd', '--brand-ink': '#eeeeee' },
  };
  // v1.6 allowed 16 KiB of guidance, 64 examples, 256 KiB each and 1 MiB together.
  const guidance = Array.from({ length: 1000 }, (_, line) => `Rule ${String(line)}: be quiet.\n\n`)
    .join('')
    .slice(0, DESIGN_SYSTEM_LIMITS.maxGuidanceBytes);
  const { files, examples: kitExamples } = userKit('legacy-kit');
  const examples: Record<string, string> = {
    ...kitExamples,
    'Large.tsx': `// ${'x'.repeat(256 * 1024 - 4)}\n`,
  };
  while (Object.keys(examples).length < CANVAS_LIMITS.maxSourceFilesPerDesign)
    examples[`Filler${String(Object.keys(examples).length)}.tsx`] = `// ${'x'.repeat(12 * 1024)}\n`;
  const swatches = {
    light: { surface: '#ffffff', accent: '#1d4ed8' },
    dark: { surface: '#0b0b0c', accent: '#93c5fd' },
  };
  const summary = { id: 'legacy-kit', version: 1, name: 'Legacy', kind: 'user', swatches };
  const system = { id: 'legacy-kit', version: 1, name: 'Legacy', modes, files, guidance, examples };
  await writeFile(
    join(directory, '1.json'),
    `{"summary":${JSON.stringify(summary)},\n"system":${JSON.stringify(system)},"mutationId":"legacy"}\n`,
  );

  const listed = (await listDesignSystems()).find((entry) => entry.id === 'legacy-kit');
  assert.deepEqual(
    { ...listed, savedAt: null },
    { ...summary, cover: false, savedAt: null, proposal: false },
  );
  const converted = await readDesignSystem({ id: 'legacy-kit', version: 1, mode: 'light' });
  assert.ok(designSystemSchema.safeParse(converted).success);
  assert.deepEqual(kitModes(converted.sections), modes);
  // Longer than one note holds, so it continues between paragraphs in the next.
  const notes = converted.sections[0]?.items.flatMap((item) =>
    item.kind === 'note' ? [item] : [],
  );
  assert.deepEqual(
    notes?.map((note) => note.label),
    ['guidance.md', 'guidance-2.md', 'guidance-3.md'],
  );
  assert.equal(notes?.map((note) => note.body).join(''), guidance);
  assert.ok(notes?.slice(0, -1).every((note) => note.body.endsWith('\n\n')));
  assert.deepEqual([converted.files, converted.examples, converted.cover], [files, examples, null]);

  const compiler = new CompilerWorker();
  t.after(() => compiler.terminate());
  for (const mode of ['light', 'dark'] as const) {
    const design = await compiler.compile(
      {
        kind: 'design',
        designId: 'pinned',
        revisionId: 'revision-1',
        generation: 1,
        files: { 'main.tsx': examples['Panel.tsx'] },
        designSystem: { id: 'legacy-kit', version: 1, mode },
        designSystemAdherence: 'off',
      },
      new AbortController().signal,
    );
    assert.deepEqual(design.diagnostics, [], 'a frame pinned to it keeps building');
    assert.ok(design.html.includes(modes[mode]['--brand-ink']));
  }

  const next = await save({ ...converted, version: 2 });
  assert.deepEqual(await readDesignSystem(next), { ...converted, version: 2 });
});

test('a linked kit directory is refused instead of followed', async (t) => {
  const outside = await scratchDirectory(t);
  const linked = join(canvasDir(), 'design-systems', 'linked-kit');
  await mkdir(join(canvasDir(), 'design-systems'), { recursive: true });
  await symlink(outside, linked, 'dir');
  t.after(() => rm(linked, { force: true }));

  await assert.rejects(save(userKit('linked-kit')), (error) => {
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

function save(kit: DesignSystem, options: { mutationId?: string; savedBy?: SavedBy } = {}) {
  return saveDesignSystem(kit, {
    mutationId: options.mutationId ?? `save-${kit.id}-${String(kit.version)}`,
    baseVersion: kit.version > 1 ? kit.version - 1 : null,
    savedBy: options.savedBy ?? { actor: 'user' },
  });
}

const PANEL_NOTE: DocumentPart = {
  kind: 'note',
  label: 'panel.md',
  body: 'Use the panel for every grouped block.',
};

function userKit(id: string, notes: DocumentPart[] = [PANEL_NOTE]): DesignSystem {
  return {
    id,
    version: 1,
    name: 'Studio',
    cover: null,
    sections: buildDocument({
      tokens: {
        light: { '--ds-canvas': '#ffffff', '--ds-accent': '#1d4ed8' },
        dark: { '--ds-canvas': '#0b0b0c', '--ds-accent': '#93c5fd' },
      },
      overview: notes,
      components: [
        { kind: 'preview', title: 'Panel', example: 'Panel.tsx', width: 480, height: 320 },
      ],
    }),
    files: {
      'index.tsx': `export function Panel({ children }: { children: unknown }) {
  return <div className="p-4">{children as never}</div>;
}
`,
    },
    examples: { 'Panel.tsx': 'export default function Example() {\n  return <p>hey</p>;\n}\n' },
  };
}

function withTokens(
  id: string,
  light: Record<string, string>,
  dark: Record<string, string>,
): DesignSystem {
  return { ...userKit(id), sections: buildDocument({ tokens: { light, dark } }) };
}

function withFiles(id: string, files: Record<string, string>): DesignSystem {
  return { ...userKit(id), files };
}
