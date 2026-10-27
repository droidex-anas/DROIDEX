import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_DESIGN_SYSTEM } from './designSystemChoices';
import { activeRow, choiceOf, pickerRows, rowAfterKey, shownKit } from './designSystemPickerRows';
import { canvasContextOf, type FramePin } from './framePins';
import type { DesignSystemRef, DesignSystemSummary } from './protocol';

function kit(id: string, name: string, kind: DesignSystemSummary['kind']): DesignSystemSummary {
  const swatch = { surface: '#fff', accent: '#000' };
  return { id, version: 1, name, kind, swatches: { light: swatch, dark: swatch } };
}

const systems = [
  kit('droidex', 'DROIDEX', 'preset'),
  kit('claude-inspired', 'Claude-inspired', 'preset'),
  kit('kit_z', 'Zinc', 'user'),
  kit('kit_a', 'Aurora', 'user'),
];

test('presets keep their order, the user’s kits read by name, and a search narrows both', () => {
  const all = pickerRows(systems, '');
  assert.deepEqual(
    all.presets.map((row) => row.id),
    ['droidex', 'claude-inspired'],
  );
  assert.deepEqual(
    all.yours.map((row) => row.name),
    ['Aurora', 'Zinc'],
  );

  const searched = pickerRows(systems, '  zi ');
  assert.deepEqual(searched.presets, []);
  assert.deepEqual(
    searched.yours.map((row) => row.name),
    ['Zinc'],
  );
});

test('the list opens on the current kit, a search on its first match, and arrows wrap', () => {
  const { presets, yours } = pickerRows(systems, '');
  const rows = [...presets, ...yours];
  const current = { id: 'kit_a', version: 1, mode: 'light' as const };

  assert.equal(activeRow(rows, null, current, false)?.name, 'Aurora');
  assert.equal(activeRow(rows, null, current, true)?.name, 'DROIDEX');
  assert.equal(activeRow(rows, 'kit_z@1', current, false)?.name, 'Zinc');

  const last = rows[rows.length - 1];
  assert.equal(rowAfterKey(rows, last, 'ArrowDown'), rows[0]);
  assert.equal(rowAfterKey(rows, rows[0], 'ArrowUp'), last);
  assert.equal(rowAfterKey(rows, rows[0], 'a'), null);
  assert.equal(rowAfterKey([], null, 'ArrowDown'), null);
});

test('picking a kit pins its version in the previewed mode', () => {
  assert.deepEqual(choiceOf(systems[1], 'dark'), {
    ref: { id: 'claude-inspired', version: 1, mode: 'dark' },
    name: 'Claude-inspired',
  });
});

test('the chip names the kit a request runs under: the choice, else the first pin’s, else DROIDEX', () => {
  const pin = (designSystem: DesignSystemRef): FramePin => ({
    canvasId: 'cv',
    designId: `d_${designSystem.id}`,
    revisionId: 'r1',
    name: 'Frame',
    size: '10 × 10',
    designSystem,
  });
  const claude = pin({ id: 'claude-inspired', version: 1, mode: 'dark' });
  const zinc = pin({ id: 'kit_z', version: 1, mode: 'light' });
  const chosen = choiceOf(systems[3], 'light');

  assert.deepEqual(shownKit([claude, zinc], chosen, systems), chosen);
  assert.deepEqual(shownKit([claude, zinc], null, systems), {
    ref: claude.designSystem,
    name: 'Claude-inspired',
  });
  assert.deepEqual(shownKit([], null, null), DEFAULT_DESIGN_SYSTEM);
  for (const [pins, choice] of [
    [[claude, zinc], chosen],
    [[zinc], null],
    [[], null],
  ] as const)
    assert.deepEqual(
      shownKit(pins, choice, systems).ref,
      canvasContextOf(pins, { designSystem: choice?.ref ?? null, imageAssetIds: [] })?.designSystem,
    );
});
