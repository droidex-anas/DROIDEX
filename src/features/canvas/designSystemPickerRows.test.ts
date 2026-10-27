import assert from 'node:assert/strict';
import test from 'node:test';
import { activeRow, choiceOf, pickerRows, rowAfterKey } from './designSystemPickerRows';
import type { DesignSystemSummary } from './protocol';

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
