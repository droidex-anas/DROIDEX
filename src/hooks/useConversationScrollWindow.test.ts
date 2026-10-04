import assert from 'node:assert/strict';
import test from 'node:test';
import {
  firstRowNotAboveViewport,
  restoreViewportAnchor,
  rowIntersectsViewport,
  scrollTopForPreservedAnchor,
  shouldCancelViewportRestore,
  shouldCaptureViewportAnchorAfterScroll,
} from './conversationViewportAnchor';
import {
  applyConversationContentResize,
  captureDisclosureAnchor,
  disclosureAnchorDelta,
  touchDisclosureAnchor,
  didCommitRequestedHistoryPrepend,
  deferredViewportRestoreAction,
  shouldBindConversationContentResize,
  shouldCompensateConversationContentResize,
  shouldLoadOlderHistoryAtTop,
  shouldReleaseConversationTranscript,
} from './conversationScrollWindow';

const settledPinned = {
  isConversationLive: false,
  isLoadingOlder: false,
  isAutoPagingOlderHistory: false,
  isPinned: true,
};

test('disclosure anchoring captures, holds, adjusts both directions, and releases', () => {
  let top = 150;
  let connected = true;
  const button = {
    get isConnected() {
      return connected;
    },
    getBoundingClientRect: () => ({ top }),
  } as HTMLElement;
  const container = {
    contains: (element: HTMLElement) => element === button,
    getBoundingClientRect: () => ({ top: 100 }),
  } as unknown as HTMLElement;
  assert.equal(captureDisclosureAnchor(container, null, 0), null);
  assert.equal(captureDisclosureAnchor(container, {} as HTMLElement, 0), null);
  const anchor = captureDisclosureAnchor(container, button, 0);
  assert.ok(anchor);
  assert.deepEqual(disclosureAnchorDelta(container, anchor, 10), { mode: 'hold' });
  top = 190;
  assert.deepEqual(disclosureAnchorDelta(container, anchor, 10), { mode: 'adjust', delta: 40 });
  top = 120;
  assert.deepEqual(disclosureAnchorDelta(container, anchor, 10), { mode: 'adjust', delta: -30 });
  touchDisclosureAnchor(anchor, 850);
  assert.equal(anchor.expiresAt, 1250);
  assert.equal(disclosureAnchorDelta(container, anchor, 1000).mode, 'adjust');
  assert.equal(disclosureAnchorDelta(container, anchor, 1251).mode, 'release');
  connected = false;
  assert.equal(disclosureAnchorDelta(container, anchor, 1000).mode, 'release');
});

test('a conversation releases its transcript only when settled, bottom-pinned, and not paging', () => {
  assert.equal(shouldReleaseConversationTranscript(settledPinned), true);
  for (const blocker of [
    { isAutoPagingOlderHistory: true },
    { isLoadingOlder: true },
    { isPinned: false },
    // Live primary and child conversations stay pinned in memory.
    { isConversationLive: true },
  ]) {
    assert.equal(
      shouldReleaseConversationTranscript({ ...settledPinned, ...blocker }),
      false,
      JSON.stringify(blocker),
    );
  }
});

test('user movement selects a fresh prepend anchor while older history is loading', () => {
  assert.equal(
    shouldCaptureViewportAnchorAfterScroll({
      isPinned: false,
      isLoadingOlder: true,
      isRestoringViewport: false,
    }),
    true,
  );
  assert.equal(
    shouldCaptureViewportAnchorAfterScroll({
      isPinned: false,
      isLoadingOlder: true,
      isRestoringViewport: true,
    }),
    false,
  );
});

test('active user movement cancels multi-frame viewport restoration', () => {
  assert.equal(shouldCancelViewportRestore(1_840, 1_840.4), false);
  assert.equal(shouldCancelViewportRestore(1_840, 1_920), true);
  assert.equal(shouldCancelViewportRestore(null, 1_920), false);
});

test('row anchoring compensates for prepends and later interactive height changes', () => {
  const captured = { scrollTop: 1_200, rowOffsetTop: -40 };

  // An older page inserts 640 px above the row currently under the viewport.
  assert.equal(scrollTopForPreservedAnchor(captured, 600), 1_840);

  // A widget above the same row then grows by another 180 px after it mounts.
  assert.equal(scrollTopForPreservedAnchor({ scrollTop: 1_840, rowOffsetTop: 600 }, 780), 2_020);

  // Height changes below the anchor do not move the reading position.
  assert.equal(scrollTopForPreservedAnchor({ scrollTop: 2_020, rowOffsetTop: 780 }, 780), 2_020);
});

test('older history loads only near the top with a cursor and no page in flight', () => {
  const nearTop = { scrollTop: 0, hasOlderCursor: true, isLoadingOlder: false };
  assert.equal(shouldLoadOlderHistoryAtTop(nearTop), true);
  assert.equal(shouldLoadOlderHistoryAtTop({ ...nearTop, scrollTop: 599 }), true);
  assert.equal(shouldLoadOlderHistoryAtTop({ ...nearTop, scrollTop: 600 }), false);
  assert.equal(shouldLoadOlderHistoryAtTop({ ...nearTop, hasOlderCursor: false }), false);
  assert.equal(shouldLoadOlderHistoryAtTop({ ...nearTop, isLoadingOlder: true }), false);
});

test('ordinary live appends do not start prepend restoration', () => {
  assert.equal(
    didCommitRequestedHistoryPrepend({
      requestedCursor: 'cursor-2',
      currentCursor: 'cursor-2',
      previousTranscriptLength: 240,
      transcriptLength: 241,
    }),
    false,
  );
  assert.equal(
    didCommitRequestedHistoryPrepend({
      requestedCursor: 'cursor-2',
      currentCursor: 'cursor-1',
      previousTranscriptLength: 240,
      transcriptLength: 289,
    }),
    true,
  );
});

test('anchor fallback ignores feed rows entirely below non-feed viewport content', () => {
  assert.equal(
    rowIntersectsViewport({
      viewportTop: 100,
      viewportBottom: 700,
      rowTop: 760,
      rowBottom: 920,
    }),
    false,
  );
  assert.equal(
    rowIntersectsViewport({
      viewportTop: 100,
      viewportBottom: 700,
      rowTop: 620,
      rowBottom: 780,
    }),
    true,
  );
});

test('anchor fallback locates a deep viewport row logarithmically', () => {
  let geometryReads = 0;
  const index = firstRowNotAboveViewport(
    10_000,
    (rowIndex) => {
      geometryReads += 1;
      return (rowIndex + 1) * 100;
    },
    543_210,
  );

  assert.equal(index, 5_432);
  assert.ok(geometryReads <= 14, `expected logarithmic reads, observed ${geometryReads}`);
});

test('content resize follows a pinned tail and preserves an unpinned row anchor', () => {
  const pinnedElement = { scrollTop: 100, scrollHeight: 2_400 } as HTMLDivElement;
  const pinned = applyConversationContentResize(pinnedElement, null, true, false);
  assert.equal(pinned.mode, 'follow-tail');
  assert.equal(pinnedElement.scrollTop, 2_400);

  const unpinnedElement = { scrollTop: 1_000, scrollHeight: 2_500 } as HTMLDivElement;
  const unpinned = applyConversationContentResize(
    unpinnedElement,
    {
      rowId: 'message-42',
      rowOffsetTop: 50,
      scrollTop: 1_000,
      scrollHeight: 2_000,
    },
    false,
    true,
    { rowContentOffset: (rowId) => (rowId === 'message-42' ? 1_200 : undefined) },
  );

  assert.equal(unpinned.mode, 'preserve-anchor');
  assert.equal(unpinned.didFindRow, true);
  assert.equal(unpinnedElement.scrollTop, 1_150);
});

test('restore without a layout offset uses height fallback, not a mounted DOM row', () => {
  const row = {
    dataset: { feedRowId: 'message-42' },
    getBoundingClientRect: () => ({ top: 300 }),
  } as HTMLElement;
  const element = {
    scrollTop: 1_000,
    scrollHeight: 2_500,
    getBoundingClientRect: () => ({ top: 100 }),
    querySelector: () => row,
    querySelectorAll: () => [row],
  } as unknown as HTMLDivElement;

  const restored = restoreViewportAnchor(
    element,
    {
      rowId: 'message-42',
      rowOffsetTop: 50,
      scrollTop: 1_000,
      scrollHeight: 2_000,
    },
    true,
  );

  assert.equal(restored.didFindRow, false);
  assert.equal(element.scrollTop, 1_500);
});

test('restore falls back to height delta when the layout misses the captured row', () => {
  const element = { scrollTop: 1_000, scrollHeight: 2_500 } as HTMLDivElement;
  const restored = restoreViewportAnchor(
    element,
    {
      rowId: 'message:gone',
      rowOffsetTop: 50,
      scrollTop: 1_000,
      scrollHeight: 2_000,
    },
    true,
    { rowContentOffset: () => undefined },
  );

  assert.equal(restored.didFindRow, false);
  assert.equal(element.scrollTop, 1_500);
});

test('virtual layout restore preserves an unpinned row when it is not mounted', () => {
  const element = { scrollTop: 400, scrollHeight: 12_000 } as HTMLDivElement;
  const restored = restoreViewportAnchor(
    element,
    {
      rowId: 'message:anchor',
      rowOffsetTop: 40,
      scrollTop: 400,
      scrollHeight: 8_000,
    },
    true,
    { rowContentOffset: (rowId) => (rowId === 'message:anchor' ? 3_200 : undefined) },
  );

  assert.equal(restored.didFindRow, true);
  assert.equal(element.scrollTop, 3_160);
  assert.equal(restored.anchor.rowId, 'message:anchor');
});

test('content resize binding follows the live first child even with an empty transcript', () => {
  const container = {} as HTMLDivElement;
  const welcome = {} as Element;
  const composeSkeleton = {} as Element;
  const binding = { element: container, content: welcome, conversationKey: 'session-a' };
  const shouldBind = (
    current: typeof binding | null,
    content: Element | null,
    conversationKey: string,
    element: HTMLDivElement | null = container,
  ) => shouldBindConversationContentResize({ binding: current, element, content, conversationKey });

  // First bind while the transcript is still empty.
  assert.equal(shouldBind(null, welcome, 'session-a'), true);
  // Same child and conversation: nothing to rebind.
  assert.equal(shouldBind(binding, welcome, 'session-a'), false);
  // The conversation content element is swapped with the transcript still at
  // zero events; the observer must follow the replacement child.
  assert.equal(shouldBind(binding, composeSkeleton, 'session-a'), true);
  // A conversation switch rebinds even when the container keeps its child.
  assert.equal(shouldBind(binding, welcome, 'session-b'), true);
  // No container or child means nothing can be observed.
  assert.equal(shouldBind(null, null, 'session-a', null), false);
});

test('content resize compensation stays off during an unpinned user scroll', () => {
  const compensate = (
    isPinned: boolean,
    isSettlingHistoryPrepend: boolean,
    isUserScrolling: boolean,
  ) =>
    shouldCompensateConversationContentResize({
      isPinned,
      isSettlingHistoryPrepend,
      isUserScrolling,
    });
  assert.equal(compensate(false, false, true), false);
  assert.equal(compensate(true, false, true), true);
  assert.equal(compensate(false, true, true), true);
  assert.equal(compensate(false, false, false), true);
});

test('deferred content-resize restore skips when a newer owner took the generation', () => {
  assert.equal(deferredViewportRestoreAction(4, 3, true), 'skip');
  assert.equal(deferredViewportRestoreAction(3, 3, true), 'retry');
  assert.equal(deferredViewportRestoreAction(3, 3, false), 'release');
});
