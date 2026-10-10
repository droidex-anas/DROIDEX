import assert from 'node:assert/strict';
import test from 'node:test';
import { NO_SHOWN_REVISIONS, missingLabel, sheetState, shownRevisions } from './previewLabels';
import type { CanvasBuildState } from './protocol';

const READY: CanvasBuildState = {
  status: 'ready',
  revisionId: 'rev_01',
  artifactId: 'a'.repeat(64),
  elements: [],
  diagnostics: [],
};

function failedOver(lastWorkingRevisionId: string | null): CanvasBuildState {
  return { status: 'failed', revisionId: 'rev_02', diagnostics: [], lastWorkingRevisionId };
}

test('a frame without a document says which of these it is', () => {
  const ready: CanvasBuildState = {
    status: 'ready',
    revisionId: 'rev_02',
    artifactId: 'a'.repeat(64),
    elements: [],
    diagnostics: [],
  };
  const failed: CanvasBuildState = {
    status: 'failed',
    revisionId: 'rev_03',
    diagnostics: [],
    lastWorkingRevisionId: 'rev_01',
  };

  // Only a miss for the revision the frame holds as `ready` is being rebuilt:
  // that read is what queues the work.
  assert.match(missingLabel('missing', ready), /Building this preview again/);
  // A `failed` frame's fallback queues nothing, so promising a rebuild would lie.
  assert.match(missingLabel('missing', failed), /no longer available/);
  assert.equal(missingLabel('missing', failed).includes('Building'), false);
  // A read that threw is neither of those.
  assert.match(missingLabel('unreadable', ready), /could not be read/);
  assert.match(missingLabel('unreadable', failed), /could not be read/);
  assert.match(missingLabel('loading', ready), /Loading this preview/);
});

test('a frame keeps the design it showed until its newer revision settles', () => {
  const before = shownRevisions(NO_SHOWN_REVISIONS, [{ designId: 'a', build: READY }]);
  assert.equal(before.get('a'), 'rev_01');

  for (const build of [
    { status: 'pending', generation: 2 },
    { status: 'building', generation: 2 },
    { status: 'cancelled', generation: 2 },
  ] as const) {
    // Nothing changed for the board, so it can keep the very same map.
    assert.equal(shownRevisions(before, [{ designId: 'a', build }]), before, build.status);
  }
  assert.equal(shownRevisions(before, [{ designId: 'a', build: failedOver('rev_01') }]), before);
  // A failure with nothing older to fall back on shows nothing.
  assert.equal(shownRevisions(before, [{ designId: 'a', build: failedOver(null) }]).size, 0);
  // A frame that was never shown has nothing to keep while it queues.
  const queued = { status: 'pending', generation: 1 } as const;
  assert.equal(shownRevisions(NO_SHOWN_REVISIONS, [{ designId: 'b', build: queued }]).size, 0);
});

test('a sheet without a live preview never hides a failure behind an older design', () => {
  const frame = (build: CanvasBuildState) => ({ revisionId: 'rev_02', build });

  assert.equal(sheetState(frame(failedOver('rev_01')), 'rev_01', false, false).kind, 'failed');
  assert.equal(sheetState(frame(READY), 'rev_01', false, false).kind, 'still');
  assert.deepEqual(sheetState(frame({ status: 'pending', generation: 1 }), null, false, false), {
    kind: 'note',
    title: 'Waiting to build',
    detail: 'It builds when a slot is free.',
  });
});
