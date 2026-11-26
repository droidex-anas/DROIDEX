import { useEffect, useRef, useState } from 'react';

import type { PrComment, PullRequest } from '../../../types/vcs';
import type { PrLineAnnotation } from '../lib/prAnnotations';
import { usePullRequestDetail } from '../hooks/usePullRequestDetail';
import { isCubicRemembered, rememberCubic } from '../lib/cubicMemory';
import { CUBIC_REVIEW_MENTION, hasCubicActivity, repoKeyFromPrUrl } from '../lib/prReview';
import { PR_DETAIL_TABS, prDetailTabId, prDetailTabPanelId, type PrDetailTab } from '../lib/prTabs';
import { PrDiff } from './PrDiff';
import { PrSummary } from './PrSummary';
import { PrToolbar } from './PrToolbar';

export function applyCommentPostSettlement(
  submitted: { cwd: string; number: number },
  current: { cwd: string; number: number },
  resultOk: boolean,
): { clearDraft: boolean; posting: false } | null {
  if (submitted.cwd !== current.cwd || submitted.number !== current.number) return null;
  return { clearDraft: resultOk, posting: false };
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function CodePane({
  diff,
  diffError,
  cwd,
  number,
  comments,
  compact,
  onSendReview,
}: {
  diff: string | null;
  diffError: string | null;
  cwd: string;
  number: number;
  comments: PrComment[];
  compact: boolean;
  // Null until the pull request loads: notes can be written, not sent yet.
  onSendReview: ((annotations: PrLineAnnotation[]) => void) | null;
}) {
  if (diffError) {
    return (
      <div className="flex h-full items-center justify-center px-8">
        <p className="text-body text-muted">{diffError}</p>
      </div>
    );
  }
  if (diff !== null) {
    return (
      <PrDiff
        // Notes being edited, folds and the tree filter all belong to one pull
        // request; a remount drops them in the same commit as the switch.
        key={`${cwd}#${String(number)}`}
        diff={diff}
        cwd={cwd}
        number={number}
        comments={comments}
        compact={compact}
        onSendReview={onSendReview}
      />
    );
  }
  return (
    <div className="flex h-full items-center justify-center px-8">
      <div className="h-16 w-full max-w-2xl rounded-lg bg-elevated/40" />
    </div>
  );
}

export function PrDetail({
  cwd,
  number,
  pr,
  compact = false,
  onOpenChat,
  onReviewWithDroid,
  onSendReview,
}: {
  cwd: string;
  number: number;
  pr: PullRequest | null;
  // The utility-pane layout: panel padding instead of page padding, a smaller
  // title, and the link actions fold into one overflow menu.
  compact?: boolean;
  onOpenChat: (pr: PullRequest) => void;
  onReviewWithDroid: (pr: PullRequest) => void;
  onSendReview: (pr: PullRequest, annotations: PrLineAnnotation[]) => void;
}) {
  const [tab, setTab] = useState<PrDetailTab>('summary');
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [requestingReview, setRequestingReview] = useState(false);
  const identityRef = useRef({ cwd, number });
  identityRef.current = { cwd, number };
  const detail = usePullRequestDetail(cwd, number, {
    active: true,
    loadDiff: tab === 'changes',
  });
  const headerPr = detail.pr ?? pr;

  const repoKey = repoKeyFromPrUrl(headerPr?.url);
  const cubicActive = hasCubicActivity(detail.comments);

  useEffect(() => {
    setTab('summary');
    setDraft('');
    setPosting(false);
    setRequestingReview(false);
  }, [cwd, number]);

  // Cubic reviewing this repository once is proof it is installed, so the
  // invitation never returns for it.
  useEffect(() => {
    if (cubicActive) rememberCubic(repoKey);
  }, [cubicActive, repoKey]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;
      if (event.target instanceof HTMLElement && !event.target.closest('[data-pr-detail-pane]')) {
        return;
      }
      const next = PR_DETAIL_TABS.find((item) => item.key === event.key);
      if (next) setTab(next.id);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const submit = () => {
    const body = draft.trim();
    if (!body) return;
    const submittedCwd = cwd;
    const submittedNumber = number;
    const submittedDraft = draft;
    setPosting(true);
    void detail.submitComment(body).then((result) => {
      const settlement = applyCommentPostSettlement(
        { cwd: submittedCwd, number: submittedNumber },
        identityRef.current,
        result.ok,
      );
      if (!settlement) return;
      // Text typed while the post was in flight is the next comment, not the
      // posted one, so only the submitted draft is cleared.
      if (settlement.clearDraft) {
        setDraft((current) => (current === submittedDraft ? '' : current));
      }
      setPosting(settlement.posting);
    });
  };

  const runCubicReview = () => {
    const submittedCwd = cwd;
    const submittedNumber = number;
    setRequestingReview(true);
    void detail.submitComment(CUBIC_REVIEW_MENTION, 'Cubic review requested').then(() => {
      if (
        identityRef.current.cwd !== submittedCwd ||
        identityRef.current.number !== submittedNumber
      )
        return;
      setRequestingReview(false);
    });
  };

  const composer = {
    draft,
    posting,
    onDraftChange: setDraft,
    onSubmit: submit,
  };

  return (
    <div data-pr-detail-pane className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PrToolbar
        tab={tab}
        pr={headerPr}
        compact={compact}
        loading={detail.loading}
        repositoryKey={cwd}
        cubicInstalled={cubicActive || isCubicRemembered(repoKey)}
        requestingReview={requestingReview}
        merging={detail.merging}
        onTabChange={setTab}
        onRefresh={detail.refresh}
        onOpenChat={onOpenChat}
        onRunCubicReview={runCubicReview}
        onReviewWithDroid={onReviewWithDroid}
        onMerge={(method) => detail.merge(method).then((result) => result.ok)}
      />
      <div className="min-h-0 flex-1">
        <div
          role="tabpanel"
          id={prDetailTabPanelId(tab)}
          aria-labelledby={prDetailTabId(tab)}
          className="h-full min-h-0"
        >
          {tab === 'summary' ? (
            <PrSummary
              // Section folds are per pull request, so the sections are rebuilt
              // rather than carried over to the next one.
              key={`${cwd}#${String(number)}`}
              pr={headerPr}
              number={number}
              body={detail.body}
              loaded={detail.loaded}
              loading={detail.loading}
              metaError={detail.metaError}
              checks={detail.checks}
              checksError={detail.checksError}
              comments={detail.comments}
              commentsError={detail.commentsError}
              commits={detail.commits}
              compact={compact}
              {...composer}
            />
          ) : (
            <CodePane
              diff={detail.diff}
              diffError={detail.diffError}
              cwd={cwd}
              number={number}
              comments={detail.comments}
              compact={compact}
              onSendReview={
                headerPr
                  ? (annotations) => {
                      onSendReview(headerPr, annotations);
                    }
                  : null
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}
