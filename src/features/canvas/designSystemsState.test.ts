import assert from 'node:assert/strict';
import test from 'node:test';
import {
  designSystemsReducer,
  initialDesignSystemsState,
  selectedSummary,
  type DesignSystemsAction,
  type DesignSystemsState,
} from './designSystemsState';
import type { DesignSystemDetail, DesignSystemSummary } from './protocol';

const SWATCHES = {
  light: { surface: '#ffffff', accent: '#8a5a1f' },
  dark: { surface: '#191817', accent: '#e3a857' },
};

function kit(id: string, version: number, kind: 'preset' | 'user' = 'user'): DesignSystemSummary {
  return { id, version, name: id, kind, swatches: SWATCHES };
}

function detail(id: string, version: number): DesignSystemDetail {
  return {
    id,
    version,
    name: id,
    modes: { light: {}, dark: {} },
    unmapped: [],
    provenance: null,
  };
}

function run(state: DesignSystemsState, ...actions: DesignSystemsAction[]): DesignSystemsState {
  return actions.reduce(designSystemsReducer, state);
}

const PRESETS = [kit('droidex', 1, 'preset'), kit('claude-inspired', 1, 'preset')];

test('the first list selects the first preset, and later lists keep or recover the selection', () => {
  let state = run(initialDesignSystemsState, { type: 'listed', systems: PRESETS });
  assert.deepEqual(state.selected, { id: 'droidex', version: 1 });

  state = run(
    state,
    { type: 'select', ref: { id: 'paper', version: 1 } },
    { type: 'listed', systems: [...PRESETS, kit('paper', 2)] },
  );
  // The agent saved a newer version since; the same kit stays selected at it.
  assert.deepEqual(state.selected, { id: 'paper', version: 2 });
  assert.equal(selectedSummary(state)?.version, 2);

  state = run(state, { type: 'listed', systems: PRESETS });
  assert.deepEqual(state.selected, { id: 'droidex', version: 1 });
});

test('a list failure is shown until a retry lists again', () => {
  const failed = run(
    initialDesignSystemsState,
    { type: 'listing' },
    { type: 'listFailed', message: 'DROIDEX is not connected.' },
  );
  assert.deepEqual(failed.list, { status: 'failed', message: 'DROIDEX is not connected.' });
  assert.equal(failed.selected, null);
  const retried = run(failed, { type: 'listing' }, { type: 'listed', systems: PRESETS });
  assert.equal(retried.list.status, 'listed');
});

test('only the selected kit’s read is kept, including its failure', () => {
  const droidex = { id: 'droidex', version: 1 };
  const claude = { id: 'claude-inspired', version: 1 };
  let state = run(
    initialDesignSystemsState,
    { type: 'listed', systems: PRESETS },
    { type: 'read', system: detail('droidex', 1) },
    { type: 'select', ref: claude },
  );
  // The earlier kit's read never shows under the new selection.
  assert.deepEqual(state.read, { status: 'loading' });
  // Its answers arriving late are dropped.
  state = run(
    state,
    { type: 'read', system: detail('droidex', 1) },
    { type: 'readFailed', ref: droidex, message: 'Stale.' },
  );
  assert.deepEqual(state.read, { status: 'loading' });

  state = run(state, { type: 'readFailed', ref: claude, message: 'Restore the saved kit.' });
  assert.deepEqual(state.read, { status: 'failed', message: 'Restore the saved kit.' });
  state = run(state, { type: 'reading' }, { type: 'read', system: detail('claude-inspired', 1) });
  assert.equal(state.read?.status, 'read');
});

test('a saved kit is selected in place of the form, with its notes until another is chosen', () => {
  const paper = { id: 'paper', version: 1 };
  const notes = [{ code: 'single_mode_token', message: '--ink has only a dark value.' }];
  let state = run(
    initialDesignSystemsState,
    { type: 'listed', systems: PRESETS },
    { type: 'compose', kind: 'designMd' },
    { type: 'saved', ref: paper, diagnostics: notes },
  );
  assert.equal(state.composing, null);
  assert.deepEqual(state.selected, paper);
  assert.deepEqual(state.importNotes, { ref: paper, diagnostics: notes });

  // The list re-read after the save still selects the new kit.
  state = run(state, { type: 'listed', systems: [...PRESETS, kit('paper', 1)] });
  assert.deepEqual(state.selected, paper);
  state = run(state, { type: 'select', ref: { id: 'droidex', version: 1 } });
  assert.equal(state.importNotes, null);
});
