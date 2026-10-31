import assert from 'node:assert/strict';
import test from 'node:test';
import { AUTO_DESIGN_SYSTEM } from './designSystemChoices';
import {
  activeRow,
  choiceOf,
  pickerRows,
  rowAfterKey,
  shownKit,
  type PickerRow,
} from './designSystemPickerRows';
import { canvasContextOf, type FramePin } from './framePins';
import type { DesignSystemRef, DesignSystemSummary } from './protocol';

function kit(id: string, name: string, kind: DesignSystemSummary['kind']): DesignSystemSummary {
  const swatch = { surface: '#fff', accent: '#000' };
  return { id, version: 1, name, kind, swatches: { light: swatch, dark: swatch } };
}

const systems = [
  kit('auto', 'Auto', 'auto'),
  kit('droidex', 'DROIDEX', 'preset'),
  kit('claude-inspired', 'Claude-inspired', 'preset'),
  kit('kit_z', 'Zinc', 'user'),
  kit('kit_a', 'Aurora', 'user'),
];

test('Auto leads, then recent kits, presets in order and the user’s kits by name; a search narrows all', () => {
  const all = pickerRows(systems, '', ['kit_z', 'kit_gone', 'droidex']);
  const names = (rows: PickerRow[]) => rows.map((row) => row.kit.name);
  assert.deepEqual(names(all.auto), ['Auto']);
  // A recent kit that is no longer saved is not offered.
  assert.deepEqual(names(all.recent), ['Zinc', 'DROIDEX']);
  assert.deepEqual(names(all.presets), ['DROIDEX', 'Claude-inspired']);
  assert.deepEqual(names(all.yours), ['Aurora', 'Zinc']);

  const searched = pickerRows(systems, '  zi ', ['kit_z']);
  assert.deepEqual(searched.auto, []);
  assert.deepEqual(searched.recent, []);
  assert.deepEqual(searched.presets, []);
  assert.deepEqual(names(searched.yours), ['Zinc']);
});

test('the list opens on the current kit, a search on its first match, and arrows wrap', () => {
  const { auto, recent, presets, yours } = pickerRows(systems, '', ['kit_z']);
  const rows = [...auto, ...recent, ...presets, ...yours];
  const current = { id: 'kit_a', version: 1, mode: 'light' as const };

  assert.equal(activeRow(rows, null, current, false)?.kit.name, 'Aurora');
  assert.equal(activeRow(rows, null, current, true)?.kit.name, 'Auto');
  assert.equal(activeRow(rows, 'user-kit_z', current, false), yours[1]);

  const last = rows[rows.length - 1];
  assert.equal(rowAfterKey(rows, last, 'ArrowDown'), rows[0]);
  assert.equal(rowAfterKey(rows, rows[0], 'ArrowUp'), last);
  assert.equal(rowAfterKey(rows, rows[0], 'a'), null);
  assert.equal(rowAfterKey([], null, 'ArrowDown'), null);
});

test('picking a kit pins its version in the previewed mode', () => {
  assert.deepEqual(choiceOf(systems[2], 'dark'), {
    ref: { id: 'claude-inspired', version: 1, mode: 'dark' },
    name: 'Claude-inspired',
  });
});

test('the chip names the kit a request runs under: the choice, else the first pin’s, else Auto', () => {
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
  const madeUnderAuto = pin(AUTO_DESIGN_SYSTEM.ref);
  const chosen = choiceOf(systems[4], 'light');

  assert.deepEqual(shownKit([claude, zinc], chosen, systems), chosen);
  assert.deepEqual(shownKit([claude, zinc], null, systems), {
    ref: claude.designSystem,
    name: 'Claude-inspired',
  });
  assert.deepEqual(shownKit([], null, null), AUTO_DESIGN_SYSTEM);
  assert.deepEqual(shownKit([madeUnderAuto], null, null), AUTO_DESIGN_SYSTEM);
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
