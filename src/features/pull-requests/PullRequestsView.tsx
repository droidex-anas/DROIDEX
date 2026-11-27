import { useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { INLINE_CARD_DURATION_S, INLINE_CARD_EASE } from '../../components/inlineCardMotion';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { useGithubSetup } from '../../hooks/useGithubSetup';
import { comparablePath } from '../../lib/pathComparison';
import { PrDetail } from './components/PrDetail';
import { PrInbox } from './components/PrInbox';
import { PrWorkspaceEmpty } from './components/PrWorkspaceEmpty';
import { usePullRequestList } from './hooks/usePullRequestList';
import { prBacklogId } from './lib/prBacklog';
import {
  applyQuickFilter,
  INITIAL_PR_BOARD_STATE,
  resolveQueuePosition,
  sortBoardPullRequests,
  type PrBoardState,
} from './lib/prBoard';
import { prChatSeed } from './lib/prChatSeed';
import {
  filterPullRequests,
  searchPullRequests,
  selectedInboxPullRequest,
  type InboxPullRequest,
} from './lib/prInbox';
import { droidReviewSeed } from './lib/prReview';
import {
  formatAnnotationsForPrompt,
  orderedAnnotations,
  type PrLineAnnotation,
} from './lib/prAnnotations';
import { prReviewKey } from './lib/prReviewState';
import { resolvePrInboxContext } from './lib/prWorkspaceCwd';

function buildQueueNav(
  queue: ReturnType<typeof resolveQueuePosition>,
  openPullRequest: (pr: InboxPullRequest) => void,
) {
  if (!queue) return null;
  const { prev, next } = queue;
  return {
    index: queue.index,
    total: queue.total,
    onPrev: prev
      ? () => {
          openPullRequest(prev);
        }
      : null,
    onNext: next
      ? () => {
          openPullRequest(next);
        }
      : null,
  };
}

function PrWorkspace({ children }: { children: ReactNode }) {
  return (
    <div data-testid="pull-requests-workspace" className="flex h-full min-h-0 flex-col">
      <div data-electron-drag-region className="h-9 shrink-0" />
      <div className="relative flex min-h-0 flex-1 overflow-hidden">{children}</div>
    </div>
  );
}

export function PullRequestsView() {
  const dispatch = useStoreDispatch();
  const reduceMotion = useReducedMotion() === true;
  const [boardState, setBoardState] = useState<PrBoardState>(INITIAL_PR_BOARD_STATE);
  const scrollTopRef = useRef(0);

  // Select the active session itself rather than the sessions record: any
  // background lifecycle update rebuilds the record, and the workspace must
  // not re-render for chats it never shows.
  const state = useStoreSelector(
    (current) => ({
      active: current.activeAppSessionId ? current.sessions[current.activeAppSessionId] : null,
      draftChat: current.draftChat,
      prBacklogIds: current.prBacklogIds,
      prWorkspaceCwd: current.prWorkspaceCwd,
      prWorkspaceNumber: current.prWorkspaceNumber,
      workspaceCwds: current.workspaceCwds,
    }),
    shallowEqual,
  );
  const active = state.active;
  const inbox = useMemo(
    () =>
      resolvePrInboxContext({
        active,
        draftCwd: state.draftChat?.cwd,
        workspaceCwds: state.workspaceCwds,
        boundCwd: state.prWorkspaceCwd,
        boundNumber: state.prWorkspaceNumber,
      }),
    [
      active,
      state.draftChat?.cwd,
      state.prWorkspaceCwd,
      state.prWorkspaceNumber,
      state.workspaceCwds,
    ],
  );
  const setup = useGithubSetup(inbox.listingCwds.length > 0, 'pr-inbox');
  const canList = inbox.listingCwds.length > 0 && setup.isReady;
  const list = usePullRequestList(inbox.listingCwds, canList);
  const backlogIds = useMemo(() => new Set(state.prBacklogIds), [state.prBacklogIds]);

  const orderedQueue = useMemo(() => {
    const scoped = boardState.repoScope
      ? list.prs.filter(
          (pr) => comparablePath(pr.cwd) === comparablePath(boardState.repoScope ?? ''),
        )
      : list.prs;
    return searchPullRequests(
      sortBoardPullRequests(
        applyQuickFilter(
          filterPullRequests(scoped, boardState.tab, list.viewerLogin, backlogIds),
          boardState.quickFilter,
          list.viewerLogin,
        ),
        boardState.sort,
        list.viewerLogin,
      ),
      boardState.query,
    );
  }, [backlogIds, boardState, list.prs, list.viewerLogin]);

  if (!canList) {
    return (
      <PrWorkspace>
        <PrWorkspaceEmpty cwd={inbox.listingCwds[0] ?? null} setup={setup} />
      </PrWorkspace>
    );
  }

  const detailCwd = inbox.boundCwd;
  const detailNumber = inbox.selectedNumber;
  const detailOpen = detailCwd != null && detailNumber != null;
  const selected = detailOpen ? selectedInboxPullRequest(list.prs, detailCwd, detailNumber) : null;
  const queue = detailOpen ? resolveQueuePosition(orderedQueue, detailCwd, detailNumber) : null;
  const travel = reduceMotion ? 0 : 16;

  const openPullRequest = (pr: InboxPullRequest) => {
    dispatch({ type: 'OPEN_PULL_REQUESTS', cwd: pr.cwd, number: pr.number });
  };

  const backToList = () => {
    dispatch({ type: 'OPEN_PULL_REQUESTS', cwd: detailCwd, number: null });
  };

  return (
    <PrWorkspace>
      <AnimatePresence initial={false} mode="wait">
        {detailOpen ? (
          <motion.div
            key="detail"
            initial={{ opacity: 0, x: travel }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: travel }}
            transition={{
              duration: reduceMotion ? 0 : INLINE_CARD_DURATION_S,
              ...(reduceMotion ? {} : { ease: INLINE_CARD_EASE }),
            }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <PrDetail
              cwd={detailCwd}
              number={detailNumber}
              pr={selected}
              onBack={backToList}
              queueNav={buildQueueNav(queue, openPullRequest)}
              onOpenChat={(item) => {
                // Start a fresh local draft in this checkout before seeding it. This
                // prevents an active chat from another workspace from owning the PR
                // prompt; sending stays the user's decision.
                dispatch({ type: 'START_CHAT', cwd: detailCwd, executionMode: 'local' });
                dispatch({
                  type: 'SEED_COMPOSER',
                  text: prChatSeed(item),
                  replace: true,
                });
              }}
              onReviewWithDroid={(item) => {
                // A local review starts as its own chat in this checkout, opened with
                // the review skill and the pull request already typed in.
                dispatch({ type: 'CLOSE_PULL_REQUESTS' });
                dispatch({ type: 'START_CHAT', cwd: detailCwd, executionMode: 'local' });
                dispatch({
                  type: 'SEED_COMPOSER',
                  text: droidReviewSeed(item),
                  replace: true,
                });
              }}
              onSendReview={(item, annotations: PrLineAnnotation[]) => {
                // The notes move into the composer as an editable prompt — sending
                // stays the user's decision — and the draft clears because its
                // content now lives there.
                const key = prReviewKey(detailCwd, item.number);
                dispatch({ type: 'CLOSE_PULL_REQUESTS' });
                dispatch({ type: 'START_CHAT', cwd: detailCwd, executionMode: 'local' });
                dispatch({
                  type: 'SEED_COMPOSER',
                  text: formatAnnotationsForPrompt(item, orderedAnnotations(annotations)),
                  replace: true,
                });
                dispatch({ type: 'PR_REVIEW_NOTES_CLEAR', key });
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -travel }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -travel }}
            transition={{
              duration: reduceMotion ? 0 : INLINE_CARD_DURATION_S,
              ...(reduceMotion ? {} : { ease: INLINE_CARD_EASE }),
            }}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <PrInbox
              prs={list.prs}
              viewerLogin={list.viewerLogin}
              currentCwd={inbox.currentCwd}
              selectedCwd={inbox.boundCwd}
              selectedNumber={inbox.selectedNumber}
              loading={list.loading || !list.loaded}
              error={list.error}
              repoErrors={list.repoErrors}
              backlogIds={backlogIds}
              boardState={boardState}
              onBoardStateChange={setBoardState}
              scrollTopRef={scrollTopRef}
              onSelect={openPullRequest}
              onRetry={list.refresh}
              onToggleBacklog={(pr) => {
                const id = prBacklogId(pr);
                dispatch({
                  type: backlogIds.has(id) ? 'RESTORE_PR_FROM_BACKLOG' : 'MOVE_PR_TO_BACKLOG',
                  id,
                });
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </PrWorkspace>
  );
}
