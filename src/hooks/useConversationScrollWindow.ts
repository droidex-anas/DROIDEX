import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { loadChildHistory, loadSessionHistory } from '../lib/commands';
import {
  captureViewportAnchor,
  restoreViewportAnchor,
  shouldCancelViewportRestore,
  viewportAnchorAfterScroll,
  type ConversationViewportLayout,
  type ViewportAnchor,
} from './conversationViewportAnchor';
import {
  applyConversationContentResize,
  captureDisclosureAnchor,
  didCommitRequestedHistoryPrepend,
  disclosureAnchorDelta,
  pinnedViewportAction,
  touchDisclosureAnchor,
  type DisclosureAnchor,
  rememberScrollSnapshot,
  restoreConversationScrollSnapshot,
  shouldBindConversationContentResize,
  shouldCompensateConversationContentResize,
  shouldLoadOlderHistoryAtTop,
  shouldReleaseConversationTranscript,
  shouldReportPinnedViewport,
  deferredViewportRestoreAction,
  isAwayFromLatest,
  nestedScrollerCanScrollUp,
  nextPinnedState,
  TOP_AUTO_LOAD_PX,
  type ConversationContentResizeBinding,
  type PendingHistoryPrepend,
  type ScrollDispatch,
  type ScrollSnapshot,
} from './conversationScrollWindow';

const HISTORY_PAGE_EVENT_LIMIT = 240;
// Reading near the thread's top pulls a large page so reaching the start of a
// long thread takes a few loads, not dozens. Protocol mirror of
// sidecar/src/SessionTimeline.ts MAX_HISTORY_PAGE_EVENTS.
export const CONVERSATION_OLDER_HISTORY_PAGE_EVENT_LIMIT = 1_600;
// Prepending while a flick is still in motion fights the reader's momentum and
// feels laggy; a prepend against a settled viewport restores with zero drift.
const SCROLL_SETTLE_MS = 200;

interface ConversationScrollWindowOptions {
  scrollRef: RefObject<HTMLDivElement | null>;
  visibleConversationKey: string | null;
  isViewingChildSession: boolean;
  activeAppSessionId: string | undefined;
  historyAppSessionId: string | undefined;
  historyChildSessionId: string | undefined;
  olderCursor: string | undefined;
  isLoadingOlder: boolean;
  transcriptLength: number;
  transcriptTailLength: number;
  retainedTranscriptLength: number;
  isConversationLive: boolean;
  isAutoPagingOlderHistory: boolean;
  dispatch: ScrollDispatch;
  viewportLayoutRef?: RefObject<ConversationViewportLayout | null>;
}

interface ActiveConversationContentResizeBinding extends ConversationContentResizeBinding {
  observer: ResizeObserver;
  releaseFrame: number;
  ownedRestoreGeneration: number | null;
}

export function useConversationScrollWindow({
  scrollRef,
  visibleConversationKey,
  isViewingChildSession,
  activeAppSessionId,
  historyAppSessionId,
  historyChildSessionId,
  olderCursor,
  isLoadingOlder,
  transcriptLength,
  transcriptTailLength,
  retainedTranscriptLength,
  isConversationLive,
  isAutoPagingOlderHistory,
  dispatch,
  viewportLayoutRef,
}: ConversationScrollWindowOptions): {
  onScroll: () => void;
  jumpToLatest: () => void;
  isAwayFromLatest: boolean;
  requestOlderHistory: (limit?: number) => void;
  restoredScrollOffset: number | undefined;
} {
  const viewportAnchor = useRef<ViewportAnchor | null>(null);
  const disclosureAnchor = useRef<DisclosureAnchor | null>(null);
  const isRestoringViewport = useRef(false);
  const isSettlingHistoryPrepend = useRef(false);
  const expectedRestoredScrollTop = useRef<number | null>(null);
  const viewportRestoreGeneration = useRef(0);
  const pendingHistoryPrepend = useRef<PendingHistoryPrepend | null>(null);
  const isPinned = useRef(true);
  // The offset the last scroll event settled at, so the next one knows which
  // way the reader moved.
  const lastScrollTop = useRef(0);
  const reportedPinned = useRef<{ conversationKey: string; pinned: boolean } | null>(null);
  const isOlderRequestPending = useRef(false);
  const isUserScrolling = useRef(false);
  const userScrollIdleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settledTopLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollSnapshots] = useState(() => new Map<string, ScrollSnapshot>());
  // The conversation whose reader is a screen or more above the latest output.
  const [awayKey, setAwayKey] = useState<string | null>(null);

  const updateAway = useCallback(
    (element: HTMLDivElement) => {
      const away = isAwayFromLatest({
        pinned: isPinned.current,
        distanceFromEnd: element.scrollHeight - element.scrollTop - element.clientHeight,
        viewportHeight: element.clientHeight,
      });
      setAwayKey(away ? visibleConversationKey : null);
    },
    [visibleConversationKey],
  );

  const cancelSettledTopLoad = useCallback(() => {
    if (settledTopLoadTimer.current === null) return;
    clearTimeout(settledTopLoadTimer.current);
    settledTopLoadTimer.current = null;
  }, []);

  const markUserScrolling = useCallback(() => {
    isUserScrolling.current = true;
    if (userScrollIdleTimer.current !== null) clearTimeout(userScrollIdleTimer.current);
    userScrollIdleTimer.current = setTimeout(() => {
      userScrollIdleTimer.current = null;
      isUserScrolling.current = false;
    }, SCROLL_SETTLE_MS);
  }, []);

  useEffect(
    () => () => {
      cancelSettledTopLoad();
      if (userScrollIdleTimer.current !== null) clearTimeout(userScrollIdleTimer.current);
    },
    [cancelSettledTopLoad, visibleConversationKey],
  );

  useEffect(() => {
    if (isLoadingOlder) return;
    isOlderRequestPending.current = false;
    pendingHistoryPrepend.current = null;
  }, [historyAppSessionId, historyChildSessionId, isLoadingOlder, olderCursor]);

  // Scroll snapshots are current before a keyed transcript swap because every
  // user and programmatic scroll passes through onScroll.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !visibleConversationKey) return;
    const snapshot = scrollSnapshots.get(visibleConversationKey);
    pendingHistoryPrepend.current = null;
    viewportRestoreGeneration.current++;
    isRestoringViewport.current = false;
    isSettlingHistoryPrepend.current = false;
    expectedRestoredScrollTop.current = null;
    viewportAnchor.current = null;
    disclosureAnchor.current = null;
    const restored = restoreConversationScrollSnapshot(
      element,
      snapshot,
      viewportLayoutRef?.current,
    );
    isPinned.current = restored.pinned;
    lastScrollTop.current = element.scrollTop;
    viewportAnchor.current = restored.anchor;
    if (activeAppSessionId) {
      reportedPinned.current = {
        conversationKey: visibleConversationKey,
        pinned: isPinned.current,
      };
      dispatch(
        isViewingChildSession && historyChildSessionId
          ? {
              type: 'CHILD_TRANSCRIPT_VIEWPORT',
              parentAppSessionId: activeAppSessionId,
              childSessionId: historyChildSessionId,
              pinned: isPinned.current,
            }
          : {
              type: 'TRANSCRIPT_VIEWPORT',
              appSessionId: activeAppSessionId,
              pinned: isPinned.current,
            },
      );
    }
  }, [
    activeAppSessionId,
    dispatch,
    historyChildSessionId,
    isViewingChildSession,
    scrollRef,
    scrollSnapshots,
    viewportLayoutRef,
    visibleConversationKey,
  ]);

  const requestOlderHistory = useCallback(
    (limit: number = HISTORY_PAGE_EVENT_LIMIT) => {
      if (!historyAppSessionId || !olderCursor || isLoadingOlder || isOlderRequestPending.current)
        return;
      isOlderRequestPending.current = true;
      const element = scrollRef.current;
      if (element && visibleConversationKey) {
        if (!isPinned.current) viewportAnchor.current = captureViewportAnchor(element, true);
        pendingHistoryPrepend.current = {
          conversationKey: visibleConversationKey,
          requestedCursor: olderCursor,
          transcriptLength,
        };
      } else {
        pendingHistoryPrepend.current = null;
      }
      if (historyChildSessionId) {
        dispatch({
          type: 'CHILD_HISTORY_LOADING_OLDER',
          parentAppSessionId: historyAppSessionId,
          childSessionId: historyChildSessionId,
        });
        loadChildHistory(historyAppSessionId, historyChildSessionId, olderCursor, limit);
      } else {
        dispatch({ type: 'SESSION_HISTORY_LOADING_OLDER', appSessionId: historyAppSessionId });
        loadSessionHistory(historyAppSessionId, olderCursor, limit);
      }
    },
    [
      dispatch,
      historyAppSessionId,
      historyChildSessionId,
      isLoadingOlder,
      olderCursor,
      scrollRef,
      transcriptLength,
      visibleConversationKey,
    ],
  );

  const setPinned = useCallback(
    (pinned: boolean) => {
      isPinned.current = pinned;
      if (!activeAppSessionId || !visibleConversationKey) return;
      if (!shouldReportPinnedViewport(reportedPinned.current, visibleConversationKey, pinned)) {
        return;
      }
      reportedPinned.current = { conversationKey: visibleConversationKey, pinned };
      dispatch(
        pinnedViewportAction({
          appSessionId: activeAppSessionId,
          childSessionId: isViewingChildSession ? historyChildSessionId : undefined,
          pinned,
        }),
      );
    },
    [
      activeAppSessionId,
      dispatch,
      historyChildSessionId,
      isViewingChildSession,
      visibleConversationKey,
    ],
  );

  // Capture-phase click: before React applies a disclosure toggle, remember
  // the clicked header's viewport position so the content-resize observer can
  // keep it under the cursor. Clicking a disclosure while pinned hands scroll
  // control to the reader: the feed stops following the tail until they
  // scroll back to the bottom. Wheel, touch, or any keydown releases the
  // anchor immediately.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const captureDisclosure = (event: MouseEvent) => {
      const button =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('button[aria-expanded]')
          : null;
      const anchor = captureDisclosureAnchor(element, button, Date.now());
      if (!anchor) return;
      disclosureAnchor.current = anchor;
      if (!isPinned.current) return;
      viewportAnchor.current = captureViewportAnchor(element, true);
      setPinned(false);
    };
    const releaseDisclosure = () => {
      disclosureAnchor.current = null;
    };
    // An upward wheel is the earliest sign the reader wants to look back. Leave
    // the tail before the scroll lands, or streamed output can snap the view
    // back down between the gesture and its scroll event.
    const readWheel = (event: WheelEvent) => {
      releaseDisclosure();
      if (event.deltaY >= 0 || element.scrollTop <= 0 || !isPinned.current) return;
      if (nestedScrollerCanScrollUp(event.target, element)) return;
      viewportAnchor.current = captureViewportAnchor(element, true);
      setPinned(false);
    };
    element.addEventListener('click', captureDisclosure, true);
    element.addEventListener('wheel', readWheel, { passive: true });
    element.addEventListener('touchstart', releaseDisclosure, { passive: true });
    element.addEventListener('keydown', releaseDisclosure);
    return () => {
      element.removeEventListener('click', captureDisclosure, true);
      element.removeEventListener('wheel', readWheel);
      element.removeEventListener('touchstart', releaseDisclosure);
      element.removeEventListener('keydown', releaseDisclosure);
    };
  }, [scrollRef, setPinned]);

  const jumpToLatest = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    disclosureAnchor.current = null;
    viewportAnchor.current = null;
    setPinned(true);
    setAwayKey(null);
    element.scrollTop = element.scrollHeight;
  }, [scrollRef, setPinned]);

  const onScroll = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const pinned = nextPinnedState({
      wasPinned: isPinned.current,
      previousScrollTop: lastScrollTop.current,
      scrollTop: element.scrollTop,
      distanceFromEnd: element.scrollHeight - element.scrollTop - element.clientHeight,
    });
    lastScrollTop.current = element.scrollTop;
    setPinned(pinned);
    updateAway(element);
    if (
      isRestoringViewport.current &&
      shouldCancelViewportRestore(expectedRestoredScrollTop.current, element.scrollTop)
    ) {
      viewportRestoreGeneration.current++;
      isRestoringViewport.current = false;
      isSettlingHistoryPrepend.current = false;
      expectedRestoredScrollTop.current = null;
      viewportAnchor.current = isPinned.current ? null : captureViewportAnchor(element, true);
    } else {
      viewportAnchor.current = viewportAnchorAfterScroll({
        element,
        anchor: viewportAnchor.current,
        isPinned: isPinned.current,
        isLoadingOlder,
        isRestoringViewport: isRestoringViewport.current,
      });
    }
    rememberScrollSnapshot(scrollSnapshots, visibleConversationKey, {
      top: element.scrollTop,
      pinned: isPinned.current,
      anchor: viewportAnchor.current,
    });

    // Every scroll event pushes the load out until the viewport settles, so a
    // page never prepends mid-flick.
    cancelSettledTopLoad();
    markUserScrolling();
    if (
      historyAppSessionId &&
      shouldLoadOlderHistoryAtTop({
        scrollTop: element.scrollTop,
        hasOlderCursor: Boolean(olderCursor),
        isLoadingOlder,
      })
    ) {
      settledTopLoadTimer.current = setTimeout(() => {
        settledTopLoadTimer.current = null;
        const settled = scrollRef.current;
        if (!settled || settled.scrollTop >= TOP_AUTO_LOAD_PX) return;
        requestOlderHistory(CONVERSATION_OLDER_HISTORY_PAGE_EVENT_LIMIT);
      }, SCROLL_SETTLE_MS);
    }
  }, [
    cancelSettledTopLoad,
    markUserScrolling,
    historyAppSessionId,
    isLoadingOlder,
    olderCursor,
    requestOlderHistory,
    scrollRef,
    scrollSnapshots,
    setPinned,
    updateAway,
    visibleConversationKey,
  ]);

  // Prepending old history keeps the exact rendered row under the user's eyes
  // fixed. A row identity is stronger than a one-shot scrollHeight delta:
  // interactive cards, diagrams, images, and content-visibility can all refine
  // their height for several frames after React commits the older page.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const pending = pendingHistoryPrepend.current;
    if (
      !element ||
      pending?.conversationKey !== visibleConversationKey ||
      !didCommitRequestedHistoryPrepend({
        requestedCursor: pending.requestedCursor,
        currentCursor: olderCursor,
        previousTranscriptLength: pending.transcriptLength,
        transcriptLength,
      }) ||
      isLoadingOlder ||
      viewportAnchor.current === null ||
      isPinned.current
    ) {
      return;
    }
    pendingHistoryPrepend.current = null;
    const restoreGeneration = ++viewportRestoreGeneration.current;
    isRestoringViewport.current = true;
    isSettlingHistoryPrepend.current = true;
    let animationFrame = 0;
    let remainingAttempts = 8;
    const settle = () => {
      if (viewportRestoreGeneration.current !== restoreGeneration) return;
      if (viewportAnchor.current === null || isPinned.current) {
        isRestoringViewport.current = false;
        isSettlingHistoryPrepend.current = false;
        expectedRestoredScrollTop.current = null;
        return;
      }
      const restored = restoreViewportAnchor(
        element,
        viewportAnchor.current,
        true,
        viewportLayoutRef?.current,
      );
      viewportAnchor.current = restored.anchor;
      expectedRestoredScrollTop.current = element.scrollTop;
      // Virtualizer measurement can keep shifting row offsets for a few frames
      // after a prepend. Recheck until the cache settles; a container observer
      // cannot see that internal redistribution.
      if (remainingAttempts > 0) {
        remainingAttempts--;
        animationFrame = requestAnimationFrame(settle);
      } else {
        if (!restored.didFindRow) {
          viewportAnchor.current = captureViewportAnchor(element, true);
        }
        isRestoringViewport.current = false;
        isSettlingHistoryPrepend.current = false;
        expectedRestoredScrollTop.current = null;
      }
    };
    settle();
    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      if (viewportRestoreGeneration.current === restoreGeneration) {
        isRestoringViewport.current = false;
        isSettlingHistoryPrepend.current = false;
        expectedRestoredScrollTop.current = null;
      }
    };
  }, [
    isLoadingOlder,
    olderCursor,
    scrollRef,
    transcriptLength,
    viewportLayoutRef,
    visibleConversationKey,
  ]);

  // Keep compensating after the prepend commit while dynamic chat content
  // settles. This applies equally to today's markdown/tool cards and future
  // interactive app blocks whose height changes after data or animation work.
  const contentResizeBindingRef = useRef<ActiveConversationContentResizeBinding | null>(null);
  const disposeContentResizeBinding = useCallback(() => {
    const binding = contentResizeBindingRef.current;
    if (!binding) return;
    contentResizeBindingRef.current = null;
    binding.observer.disconnect();
    if (binding.releaseFrame) cancelAnimationFrame(binding.releaseFrame);
    if (
      binding.ownedRestoreGeneration !== null &&
      viewportRestoreGeneration.current === binding.ownedRestoreGeneration
    ) {
      isRestoringViewport.current = false;
      expectedRestoredScrollTop.current = null;
    }
  }, []);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    const content = element?.firstElementChild ?? null;
    if (typeof ResizeObserver === 'undefined' || !element || !content) {
      disposeContentResizeBinding();
      return;
    }
    if (
      !shouldBindConversationContentResize({
        binding: contentResizeBindingRef.current,
        element,
        content,
        conversationKey: visibleConversationKey,
      })
    )
      return;
    disposeContentResizeBinding();
    const binding: ActiveConversationContentResizeBinding = {
      element,
      content,
      conversationKey: visibleConversationKey,
      observer: new ResizeObserver(() => {
        const disclosure = disclosureAnchor.current;
        if (disclosure) {
          const action = disclosureAnchorDelta(element, disclosure, Date.now());
          if (action.mode === 'release') {
            disclosureAnchor.current = null;
          } else {
            if (action.mode === 'adjust') {
              element.scrollTop += action.delta;
              touchDisclosureAnchor(disclosure, Date.now());
            }
            return;
          }
        }
        if (
          !shouldCompensateConversationContentResize({
            isPinned: isPinned.current,
            isSettlingHistoryPrepend: isSettlingHistoryPrepend.current,
            isUserScrolling: isUserScrolling.current,
          })
        ) {
          return;
        }
        if (isPinned.current) {
          // Images, interactive Apps, and disclosures can grow without changing
          // transcript length. A bottom-pinned reader follows that growth just as
          // they follow newly appended output.
          applyConversationContentResize(
            element,
            viewportAnchor.current,
            true,
            false,
            viewportLayoutRef?.current,
          );
          return;
        }
        if (viewportAnchor.current === null) return;
        const ownsRestore = !isRestoringViewport.current;
        const restoreGeneration = ownsRestore
          ? ++viewportRestoreGeneration.current
          : viewportRestoreGeneration.current;
        isRestoringViewport.current = true;
        const restored = applyConversationContentResize(
          element,
          viewportAnchor.current,
          false,
          isSettlingHistoryPrepend.current,
          viewportLayoutRef?.current,
        );
        if (restored.mode !== 'preserve-anchor') return;
        viewportAnchor.current = restored.anchor;
        expectedRestoredScrollTop.current = element.scrollTop;
        if (ownsRestore) {
          binding.ownedRestoreGeneration = restoreGeneration;
          if (binding.releaseFrame) cancelAnimationFrame(binding.releaseFrame);
          binding.releaseFrame = requestAnimationFrame(() => {
            binding.ownedRestoreGeneration = null;
            const action = deferredViewportRestoreAction(
              viewportRestoreGeneration.current,
              restoreGeneration,
              viewportAnchor.current !== null && !restored.didFindRow,
            );
            if (action === 'skip') return;
            if (action === 'retry' && viewportAnchor.current !== null) {
              const retried = restoreViewportAnchor(
                element,
                viewportAnchor.current,
                false,
                viewportLayoutRef?.current,
              );
              viewportAnchor.current = retried.didFindRow
                ? retried.anchor
                : captureViewportAnchor(element, true);
              expectedRestoredScrollTop.current = element.scrollTop;
            }
            isRestoringViewport.current = false;
            expectedRestoredScrollTop.current = null;
          });
        }
      }),
      releaseFrame: 0,
      ownedRestoreGeneration: null,
    };
    contentResizeBindingRef.current = binding;
    binding.observer.observe(content);
  });
  useEffect(() => disposeContentResizeBinding, [disposeContentResizeBinding]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    if (isPinned.current) {
      element.scrollTop = element.scrollHeight;
    } else {
      // Output landing below a reader who is not scrolling can carry them a
      // screen away from the tail.
      updateAway(element);
    }
  }, [scrollRef, transcriptLength, transcriptTailLength, updateAway]);

  useEffect(() => {
    if (
      !activeAppSessionId ||
      !shouldReleaseConversationTranscript({
        isConversationLive,
        isLoadingOlder,
        isAutoPagingOlderHistory,
        isPinned: isPinned.current,
      })
    )
      return;
    dispatch(
      isViewingChildSession && historyChildSessionId
        ? {
            type: 'CHILD_TRANSCRIPT_RELEASE_VIEWPORT',
            parentAppSessionId: activeAppSessionId,
            childSessionId: historyChildSessionId,
          }
        : { type: 'TRANSCRIPT_RELEASE_VIEWPORT', appSessionId: activeAppSessionId },
    );
  }, [
    activeAppSessionId,
    dispatch,
    historyChildSessionId,
    isAutoPagingOlderHistory,
    isConversationLive,
    isLoadingOlder,
    isViewingChildSession,
    retainedTranscriptLength,
  ]);

  return {
    onScroll,
    jumpToLatest,
    isAwayFromLatest: awayKey !== null && awayKey === visibleConversationKey,
    requestOlderHistory,
    restoredScrollOffset:
      visibleConversationKey && scrollSnapshots.has(visibleConversationKey)
        ? scrollSnapshots.get(visibleConversationKey)?.top
        : undefined,
  };
}
