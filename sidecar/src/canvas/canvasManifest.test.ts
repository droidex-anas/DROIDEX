import assert from 'node:assert/strict';
import test from 'node:test';
import { ledgerAtCapacity } from '../testing/canvasStorageSupport.js';
import {
  CANVAS_MUTATION_RETENTION,
  emptyCanvasManifest,
  mutationFingerprint,
  recordedArrange,
  recordedCreate,
  recordedRevision,
  recordMutation,
  type PersistedDesign,
  type PersistedMutation,
} from './canvasManifest.js';
import type { CanvasBuildState } from './protocol.js';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;

const design: PersistedDesign = {
  designId: 'dsg_hey',
  name: 'Hey',
  rect: { x: 0, y: 0, width: 720, height: 720 },
  layoutVersion: 0,
  manifestVersion: 0,
  revisionId: null,
  lastWorkingRevisionId: null,
  designSystem,
};

/** These cases are about the ledger, where nothing has been built yet. */
const unbuilt = { stateOf: (): CanvasBuildState => ({ status: 'pending', generation: 0 }) };

const createInput = {
  mutationId: 'create-hey',
  frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
};

function createRecord(scopeId: string): PersistedMutation {
  return {
    kind: 'create',
    mutationId: createInput.mutationId,
    scopeId,
    fingerprint: mutationFingerprint(createInput),
    designs: [design],
  };
}

function arrangeRecord(mutationId: string, scopeId: string): PersistedMutation {
  return {
    kind: 'arrange',
    mutationId,
    scopeId,
    fingerprint: mutationFingerprint({ mutationId }),
    sequence: 1,
    placements: [],
  };
}

const anyLeaseLives = (): boolean => true;

test('an unsettled receipt is never retired, and settled ones go oldest first', () => {
  const manifest = emptyCanvasManifest('cv_01', 'Canvas 1', 1_767_225_600_000);
  const live = (scopeId: string): boolean => scopeId === 'live';
  for (let index = 0; index < CANVAS_MUTATION_RETENTION.retained; index += 1) {
    recordMutation(manifest, arrangeRecord(`settled-${String(index)}`, 'settled'), live);
  }
  recordMutation(manifest, arrangeRecord('kept', 'live'), live);
  // One receipt past the retained count retires the oldest settled one.
  assert.equal(manifest.mutations.length, CANVAS_MUTATION_RETENTION.retained);
  assert.equal(manifest.mutations[0]?.mutationId, 'settled-1');

  // A live lease's receipts stay, however many settled ones have to give way.
  for (let index = 0; index < 64; index += 1) {
    recordMutation(manifest, arrangeRecord(`live-${String(index)}`, 'live'), live);
  }
  assert.equal(manifest.mutations.filter((entry) => entry.scopeId === 'live').length, 65);
  assert.equal(manifest.mutations.length, CANVAS_MUTATION_RETENTION.retained);
});

test('a ledger of unsettled receipts refuses the next mutation', () => {
  const manifest = ledgerAtCapacity('cv_01', 'app-1', design, createRecord('scope-b'));
  assert.equal(manifest.mutations.length, CANVAS_MUTATION_RETENTION.unsettled);
  assert.throws(
    () => recordMutation(manifest, arrangeRecord('one-more', 'scope-b'), anyLeaseLives),
    { code: 'storage_failed' },
  );
  // Nothing gave way to make room, so every receipt still answers its retry.
  assert.equal(manifest.mutations.length, CANVAS_MUTATION_RETENTION.unsettled);
  const recorded = recordedCreate(
    manifest,
    createInput.mutationId,
    mutationFingerprint(createInput),
    unbuilt,
  );
  assert.equal(recorded?.frames[0]?.designId, design.designId);

  // Once those leases settle, the ledger takes work again.
  recordMutation(manifest, arrangeRecord('after', 'scope-b'), (scopeId) => scopeId === 'scope-b');
  assert.equal(manifest.mutations.length, CANVAS_MUTATION_RETENTION.retained);
});

test('a receipt answers only the request and the command it was issued for', () => {
  const manifest = emptyCanvasManifest('cv_01', 'Canvas 1', 1_767_225_600_000);
  const fingerprint = mutationFingerprint(createInput);
  recordMutation(manifest, createRecord('scope-1'), anyLeaseLives);
  assert.equal(
    recordedCreate(manifest, createInput.mutationId, fingerprint, unbuilt)?.canvasId,
    'cv_01',
  );
  assert.throws(
    () =>
      recordedCreate(
        manifest,
        createInput.mutationId,
        mutationFingerprint({ ...createInput, frames: [] }),
        unbuilt,
      ),
    { code: 'invalid_input' },
  );
  assert.throws(() => recordedRevision(manifest, createInput.mutationId, 'write', fingerprint), {
    code: 'invalid_input',
  });
  assert.equal(recordedArrange(manifest, 'never-issued', fingerprint, unbuilt), null);
});
