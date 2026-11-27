import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Ellipsis,
  ExternalLink,
  MessageBubble,
  RefreshCw,
} from '@droidex/icons';
import { motion, useReducedMotion } from 'framer-motion';

import { Button } from '../../../components/ui/Button';
import { Menu } from '../../../components/ui/Menu';
import { Tooltip } from '../../../components/ui/Tooltip';
import { openExternal } from '../../../lib/onboarding';
import type { PrMergeMethod, PullRequest } from '../../../types/vcs';
import {
  arrowKeyTab,
  PR_DETAIL_TABS,
  prDetailTabId,
  prDetailTabPanelId,
  type PrDetailTab,
} from '../lib/prTabs';
import { PrMergeButton } from './PrMergeButton';
import { PrReviewButton } from './PrReviewButton';

export interface PrToolbarQueueNav {
  index: number;
  total: number;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
}

const COPIED_MS = 1200;
const TAB_SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const;
const compactCount = new Intl.NumberFormat('en', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

function ChangeCounts({ pr }: { pr: PullRequest }) {
  return (
    <span className="text-caption tabular-nums">
      <span style={{ color: 'var(--diff-add-fg)' }}>+{compactCount.format(pr.additions)}</span>{' '}
      <span style={{ color: 'var(--diff-del-fg)' }}>−{compactCount.format(pr.deletions)}</span>
    </span>
  );
}

function PrTabs({
  tab,
  pr,
  showCounts,
  onTabChange,
}: {
  tab: PrDetailTab;
  pr: PullRequest | null;
  showCounts: boolean;
  onTabChange: (tab: PrDetailTab) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, current: PrDetailTab) => {
    const next = arrowKeyTab(PR_DETAIL_TABS, current, event.key);
    if (!next) return;
    event.preventDefault();
    onTabChange(next);
    document.getElementById(prDetailTabId(next))?.focus();
  };
  return (
    <div
      role="tablist"
      aria-label="Pull request views"
      className="relative isolate flex shrink-0 items-center gap-0.5 rounded-md bg-elevated p-0.5"
    >
      {PR_DETAIL_TABS.map((item) => {
        const selected = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={prDetailTabId(item.id)}
            aria-controls={prDetailTabPanelId(item.id)}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onKeyDown={(event) => {
              onKeyDown(event, item.id);
            }}
            onClick={() => {
              onTabChange(item.id);
            }}
            className={`relative flex h-control-sm select-none items-center gap-1.5 rounded-sm px-2.5 text-label transition-colors duration-quick ${
              selected ? 'text-primary' : 'text-muted hover:text-secondary'
            }`}
          >
            {item.label}
            {item.id === 'changes' && showCounts && pr ? <ChangeCounts pr={pr} /> : null}
            {selected ? (
              <motion.span
                layoutId="pr-detail-tab-pill"
                aria-hidden="true"
                transition={reduceMotion ? { duration: 0 } : TAB_SPRING}
                className="pointer-events-none absolute inset-0 -z-10 rounded-sm bg-active shadow-sm"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// Copying swaps the icon to a check for a moment (feel.md "Copied"), no toast.
function useCopied(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
      }, COPIED_MS);
    });
  };
  return [copied, copy];
}

// The narrow pane folds everything but review and merge into one menu, so the
// strip keeps a single row at the pane's width.
function OverflowActions({
  pr,
  onRefresh,
  onOpenChat,
}: {
  pr: PullRequest | null;
  onRefresh: () => void;
  onOpenChat: (pr: PullRequest) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const url = pr?.url ?? null;

  return (
    <>
      <Tooltip label="More actions" placement="bottom">
        <Button
          ref={triggerRef}
          variant="ghost"
          size="sm"
          icon={Ellipsis}
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
        />
      </Tooltip>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={triggerRef}
        placement="bottom-end"
        label="Pull request actions"
        width={240}
      >
        <Menu.Item
          icon={MessageBubble}
          disabled={!pr}
          onSelect={() => {
            if (pr) onOpenChat(pr);
          }}
        >
          Chat about this pull request
        </Menu.Item>
        <Menu.Item icon={RefreshCw} onSelect={onRefresh}>
          Refresh
        </Menu.Item>
        <Menu.Item
          icon={Copy}
          disabled={!url}
          onSelect={() => {
            if (url) void navigator.clipboard.writeText(url);
          }}
        >
          Copy link
        </Menu.Item>
        <Menu.Item
          icon={ExternalLink}
          disabled={!url}
          onSelect={() => {
            if (url) void openExternal(url);
          }}
        >
          Open on GitHub
        </Menu.Item>
      </Menu>
    </>
  );
}

// The workspace has room to show each secondary action as its own icon button,
// with the chat handoff labelled beside them.
function InlineActions({
  pr,
  loading,
  onRefresh,
  onOpenChat,
}: {
  pr: PullRequest | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenChat: (pr: PullRequest) => void;
}) {
  const [copied, copy] = useCopied();
  const url = pr?.url ?? null;

  return (
    <>
      <div className="flex items-center gap-1">
        <Tooltip label="Refresh" placement="bottom">
          <Button
            variant="ghost"
            size="sm"
            icon={RefreshCw}
            loading={loading}
            aria-label="Refresh"
            onClick={onRefresh}
          />
        </Tooltip>
        <Tooltip label={copied ? 'Copied' : 'Copy link'} placement="bottom">
          <Button
            variant="ghost"
            size="sm"
            icon={copied ? Check : Copy}
            aria-label="Copy link"
            disabled={!url}
            onClick={() => {
              if (url) copy(url);
            }}
          />
        </Tooltip>
        <Tooltip label="Open on GitHub" placement="bottom">
          <Button
            variant="ghost"
            size="sm"
            icon={ExternalLink}
            aria-label="Open on GitHub"
            disabled={!url}
            onClick={() => {
              if (url) void openExternal(url);
            }}
          />
        </Tooltip>
      </div>
      <Tooltip label="Start a chat about this pull request" placement="bottom">
        <Button
          variant="ghost"
          size="sm"
          icon={MessageBubble}
          disabled={!pr}
          onClick={() => {
            if (pr) onOpenChat(pr);
          }}
        >
          Chat
        </Button>
      </Tooltip>
    </>
  );
}

// The strip above the content: the views on the left, then the secondary
// actions, review and merge on the right, in rising order of consequence.
export function PrToolbar({
  tab,
  pr,
  compact,
  loading,
  repositoryKey,
  cubicInstalled,
  requestingReview,
  merging,
  onBack,
  queueNav,
  onTabChange,
  onRefresh,
  onOpenChat,
  onRunCubicReview,
  onReviewWithDroid,
  onMerge,
}: {
  tab: PrDetailTab;
  pr: PullRequest | null;
  compact: boolean;
  loading: boolean;
  repositoryKey: string;
  cubicInstalled: boolean;
  requestingReview: boolean;
  merging: boolean;
  onBack?: () => void;
  queueNav?: PrToolbarQueueNav | null;
  onTabChange: (tab: PrDetailTab) => void;
  onRefresh: () => void;
  onOpenChat: (pr: PullRequest) => void;
  onRunCubicReview: () => void;
  onReviewWithDroid: (pr: PullRequest) => void;
  onMerge: (method: PrMergeMethod) => Promise<boolean>;
}) {
  return (
    // This strip sits where the window's title bar would be, so it carries
    // the drag region the session view gets from its floating controls.
    <div
      data-electron-drag-region
      className={`flex h-12 shrink-0 items-center gap-2 ${compact ? 'px-3' : 'px-6'}`}
    >
      {onBack && !compact ? (
        <Tooltip label="Back to pull requests (Esc)" placement="bottom">
          <Button variant="ghost" size="sm" icon={ArrowLeft} className="-ml-2.5" onClick={onBack}>
            Pull Requests
          </Button>
        </Tooltip>
      ) : null}
      {queueNav && queueNav.total > 1 && !compact ? (
        <div className="flex shrink-0 items-center gap-0.5">
          <Tooltip label="Previous pull request ([)" placement="bottom">
            <Button
              variant="ghost"
              size="sm"
              icon={ChevronUp}
              aria-label="Previous pull request"
              disabled={!queueNav.onPrev}
              onClick={() => {
                queueNav.onPrev?.();
              }}
            />
          </Tooltip>
          <span className="px-1 text-caption tabular-nums text-muted">
            {queueNav.index + 1}/{queueNav.total}
          </span>
          <Tooltip label="Next pull request (])" placement="bottom">
            <Button
              variant="ghost"
              size="sm"
              icon={ChevronDown}
              aria-label="Next pull request"
              disabled={!queueNav.onNext}
              onClick={() => {
                queueNav.onNext?.();
              }}
            />
          </Tooltip>
        </div>
      ) : null}
      <PrTabs tab={tab} pr={pr} showCounts={!compact} onTabChange={onTabChange} />
      <div className="ml-auto flex min-w-0 items-center gap-2">
        {compact ? (
          <OverflowActions pr={pr} onRefresh={onRefresh} onOpenChat={onOpenChat} />
        ) : (
          <InlineActions pr={pr} loading={loading} onRefresh={onRefresh} onOpenChat={onOpenChat} />
        )}
        <PrReviewButton
          pr={pr}
          cubicInstalled={cubicInstalled}
          requesting={requestingReview}
          onRunCubicReview={onRunCubicReview}
          onReviewWithDroid={() => {
            if (pr) onReviewWithDroid(pr);
          }}
        />
        <PrMergeButton pr={pr} repositoryKey={repositoryKey} merging={merging} onMerge={onMerge} />
      </div>
    </div>
  );
}
