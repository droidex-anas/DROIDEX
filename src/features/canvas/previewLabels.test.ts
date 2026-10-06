import assert from 'node:assert/strict';
import test from 'node:test';
import { missingLabel } from './previewLabels';
import type { CanvasBuildState } from './protocol';

test('a frame without a document says which of these it is', () => {
  const ready: CanvasBuildState = {
    status: 'ready',
    revisionId: 'rev_02',
    artifactId: 'a'.repeat(64),
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
