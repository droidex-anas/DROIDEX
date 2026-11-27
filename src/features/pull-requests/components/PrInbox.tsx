import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { RefreshCw, Search, X } from '@droidex/icons';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { CountBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { comparablePath } from '../../../lib/pathComparison';
import { workspaceName } from '../../../lib/workspaces';
import {
  applyQuickFilter,
  groupByWorkflowStatus,
  INITIAL_PR_BOARD_STATE,
  prRowKey,
  sortBoardPullRequests,
  stepFocusedPrKey,
  type PrBoardState,
} from '../lib/prBoard';
import {
  attachInboxRepoErrors,
  ensureCurrentInboxGroup,
  filterPullRequests,
  groupInboxPullRequests,
  inboxGroupIsExpanded,
  orderInboxGroups,
  prInboxEmptyCopy,
  searchPullRequests,
  type InboxPullRequest,
  type PrInboxTab,
} from '../lib/prInbox';
import { arrowKeyTab } from '../lib/prTabs';
import type { InboxRepoError } from '../lib/prListState';
import { collectRepoOptions, PrFilterMenu, RepoScopeMenu } from './PrBoardMenus';
import { PrInboxGroups } from './PrInboxGroups';

const TABS: { id: PrInboxTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'authored', label: 'Authored' },
  { id: 'backlog', label: 'Backlog' },
];

const TAB_PANEL_ID = 'pull-request-filter-tabpanel';
const TAB_SPRING = { type: 'spring', stiffness: 520, damping: 38 } as const;

function tabId(tab: PrInboxTab): string {
  return `pull-request-filter-${tab}-tab`;
}

function isOverlayOrInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest(
      'input, textarea, select, [contenteditable="true"], [role="menu"], [role="dialog"]',
    ),
  );
}

function keyStepDelta(key: string): 1 | -1 | null {
  if (key === 'j' || key === 'ArrowDown') return 1;
  if (key === 'k' || key === 'ArrowUp') return -1;
  return null;
}

interface BoardKeyOptions {
  flatVisible: readonly InboxPullRequest[];
  focusedKey: string | null;
  setFocusedKey: (key: string | null) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onSelect: (pr: InboxPullRequest) => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}

function handleBoardKey(event: globalThis.KeyboardEvent, options: BoardKeyOptions) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault();
    options.searchInputRef.current?.focus();
    options.searchInputRef.current?.select();
    return;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || isOverlayOrInput(event.target)) return;
  if (event.key === '/') {
    event.preventDefault();
    options.searchInputRef.current?.focus();
    return;
  }
  const delta = keyStepDelta(event.key);
  if (delta !== null) {
    const next = stepFocusedPrKey(options.flatVisible, options.focusedKey, delta);
    if (next) {
      event.preventDefault();
      options.setFocusedKey(next);
    }
    return;
  }
  const target = options.focusedKey
    ? options.flatVisible.find((item) => prRowKey(item) === options.focusedKey)
    : null;
  if (!target) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    options.onSelect(target);
  } else if (event.key === 'b') {
    event.preventDefault();
    options.onToggleBacklog(target);
  }
}

function useBoardKeyboard(options: BoardKeyOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      handleBoardKey(event, optionsRef.current);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}

function toggleSetMember(current: Set<string>, key: string): Set<string> {
  const next = new Set(current);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

export function PrInbox({
  prs,
  viewerLogin,
  currentCwd,
  selectedCwd,
  selectedNumber,
  loading,
  error,
  repoErrors,
  backlogIds,
  boardState,
  onBoardStateChange,
  scrollTopRef,
  onSelect,
  onRetry,
  onToggleBacklog,
}: {
  prs: InboxPullRequest[];
  viewerLogin: string | null;
  currentCwd: string | null;
  selectedCwd: string | null;
  selectedNumber: number | null;
  loading: boolean;
  error: string | null;
  repoErrors: InboxRepoError[];
  backlogIds: ReadonlySet<string>;
  boardState?: PrBoardState;
  onBoardStateChange?: (next: PrBoardState) => void;
  scrollTopRef?: RefObject<number>;
  onSelect: (pr: InboxPullRequest) => void;
  onRetry: () => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  const reduceMotion = useReducedMotion() === true;
  const [internalState, setInternalState] = useState<PrBoardState>(INITIAL_PR_BOARD_STATE);
  const state = boardState ?? internalState;
  const updateState = (patch: Partial<PrBoardState>) => {
    const next = { ...state, ...patch };
    if (onBoardStateChange) onBoardStateChange(next);
    else setInternalState(next);
  };
  const { tab, query, quickFilter, sort, repoScope } = state;

  const [expandedOther, setExpandedOther] = useState<Set<string>>(() => new Set());
  const [collapsedStatuses, setCollapsedStatuses] = useState<Set<string>>(() => new Set());
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current && scrollTopRef && scrollTopRef.current > 0) {
      scrollRef.current.scrollTop = scrollTopRef.current;
    }
  }, [scrollTopRef]);

  const repoOptions = useMemo(
    () => collectRepoOptions(currentCwd, prs, repoErrors),
    [currentCwd, prs, repoErrors],
  );
  const scopedPrs = useMemo(
    () =>
      repoScope ? prs.filter((pr) => comparablePath(pr.cwd) === comparablePath(repoScope)) : prs,
    [prs, repoScope],
  );
  const visible = useMemo(
    () =>
      searchPullRequests(
        sortBoardPullRequests(
          applyQuickFilter(
            filterPullRequests(scopedPrs, tab, viewerLogin, backlogIds),
            quickFilter,
            viewerLogin,
          ),
          sort,
          viewerLogin,
        ),
        query,
      ),
    [backlogIds, query, quickFilter, scopedPrs, sort, tab, viewerLogin],
  );
  const tabCounts = useMemo(() => {
    const counts = new Map<PrInboxTab, number>();
    for (const item of TABS) {
      counts.set(item.id, filterPullRequests(scopedPrs, item.id, viewerLogin, backlogIds).length);
    }
    return counts;
  }, [backlogIds, scopedPrs, viewerLogin]);

  const activeCurrentCwd = repoScope ?? currentCwd;
  const scopedRepoErrors = useMemo(
    () =>
      repoScope
        ? repoErrors.filter((item) => comparablePath(item.cwd) === comparablePath(repoScope))
        : repoErrors,
    [repoErrors, repoScope],
  );
  const groups = useMemo(
    () =>
      orderInboxGroups(
        ensureCurrentInboxGroup(
          attachInboxRepoErrors(groupInboxPullRequests(visible), scopedRepoErrors),
          activeCurrentCwd,
          activeCurrentCwd ? workspaceName(activeCurrentCwd) : '',
        ),
        activeCurrentCwd,
      ),
    [activeCurrentCwd, scopedRepoErrors, visible],
  );

  const flatVisible = useMemo(() => {
    const items: InboxPullRequest[] = [];
    for (const group of groups) {
      const expanded = inboxGroupIsExpanded({
        cwd: group.cwd,
        currentCwd: activeCurrentCwd,
        expandedOther,
        searching: query.trim().length > 0,
        selectedCwd,
      });
      if (!expanded) continue;
      for (const statusGroup of groupByWorkflowStatus(group.prs, viewerLogin, tab === 'backlog')) {
        if (collapsedStatuses.has(`${comparablePath(group.cwd)}:${statusGroup.id}`)) continue;
        items.push(...statusGroup.prs);
      }
    }
    return items;
  }, [
    activeCurrentCwd,
    collapsedStatuses,
    expandedOther,
    groups,
    query,
    selectedCwd,
    tab,
    viewerLogin,
  ]);

  useBoardKeyboard({
    flatVisible,
    focusedKey,
    setFocusedKey,
    searchInputRef,
    onSelect,
    onToggleBacklog,
  });

  const showSkeleton = loading && prs.length === 0;
  const multiRepo = groups.length > 1 || scopedRepoErrors.length > 0;
  const totalOpenCount = tabCounts.get('all') ?? 0;

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: PrInboxTab) => {
    const next = arrowKeyTab(TABS, current, event.key);
    if (!next) return;
    event.preventDefault();
    updateState({ tab: next });
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 px-8 pt-4 pb-3">
        <h1 className="text-title text-primary">Pull Requests</h1>
        {totalOpenCount > 0 ? <CountBadge size="md">{totalOpenCount}</CountBadge> : null}
        <RepoScopeMenu
          repos={repoOptions}
          repoScope={repoScope}
          onSelect={(nextScope) => {
            updateState({ repoScope: nextScope });
          }}
        />
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            loading={loading}
            onClick={onRetry}
            aria-label="Refresh"
          >
            Refresh
          </Button>
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2.5 px-8 pb-3">
        <div
          role="tablist"
          aria-label="Pull request filters"
          className="relative isolate flex items-center gap-0.5 rounded-md bg-elevated p-0.5"
        >
          {TABS.map((item) => {
            const selected = tab === item.id;
            const count = tabCounts.get(item.id) ?? 0;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={selected}
                id={tabId(item.id)}
                aria-controls={TAB_PANEL_ID}
                tabIndex={selected ? 0 : -1}
                onKeyDown={(event) => {
                  onTabKeyDown(event, item.id);
                }}
                onClick={() => {
                  updateState({ tab: item.id });
                }}
                className={`relative flex h-control-sm select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-sm px-2.5 text-label transition-colors duration-quick ${
                  selected ? 'text-primary' : 'text-muted hover:text-secondary'
                }`}
              >
                {item.label}
                {count > 0 ? (
                  <CountBadge aria-hidden="true" size="sm" tone={selected ? 'active' : 'recessed'}>
                    {count}
                  </CountBadge>
                ) : null}
                {selected ? (
                  <motion.span
                    layoutId="pr-inbox-tab-pill"
                    aria-hidden="true"
                    transition={reduceMotion ? { duration: 0 } : TAB_SPRING}
                    className="pointer-events-none absolute inset-0 -z-10 rounded-sm bg-active shadow-sm"
                  />
                ) : null}
              </button>
            );
          })}
        </div>

        <PrFilterMenu
          quickFilter={quickFilter}
          sort={sort}
          onQuickFilterChange={(next) => {
            updateState({ quickFilter: next });
          }}
          onSortChange={(next) => {
            updateState({ sort: next });
          }}
        />

        <div className="ml-auto w-64 max-w-full">
          <Input
            ref={searchInputRef}
            variant="compact"
            value={query}
            onChange={(event) => {
              updateState({ query: event.target.value });
            }}
            aria-label="Search pull requests"
            placeholder="Search pull requests…"
            leading={<Search className="mr-1.5 size-icon-sm" />}
            actions={
              query ? (
                <button
                  type="button"
                  aria-label="Clear search"
                  title="Clear search"
                  onClick={() => {
                    updateState({ query: '' });
                  }}
                  className="flex size-control-sm items-center justify-center rounded-md text-muted transition-colors hover:bg-active hover:text-primary"
                >
                  <X className="size-icon-sm" />
                </button>
              ) : undefined
            }
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                if (query) updateState({ query: '' });
                else searchInputRef.current?.blur();
              }
            }}
          />
        </div>
      </div>

      {error ? (
        <div className="flex shrink-0 items-center gap-2 px-8 pb-3 text-caption text-muted">
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        role="tabpanel"
        id={TAB_PANEL_ID}
        aria-labelledby={tabId(tab)}
        onScroll={(event) => {
          if (scrollTopRef) scrollTopRef.current = event.currentTarget.scrollTop;
        }}
        className="pr-workspace-scroll scroll-fade-y-end min-h-0 flex-1 overflow-y-auto px-5 pb-8"
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={`${tab}:${quickFilter}:${repoScope ?? 'all'}`}
            initial={reduceMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: reduceMotion ? 0 : 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            <PrInboxGroups
              loading={showSkeleton}
              error={error}
              emptyCopy={
                quickFilter !== 'all'
                  ? 'No pull requests match the active filter.'
                  : prInboxEmptyCopy(tab, query, multiRepo)
              }
              currentEmptyCopy={
                quickFilter !== 'all'
                  ? 'No pull requests match the active filter.'
                  : prInboxEmptyCopy(tab, query)
              }
              groups={groups}
              currentCwd={activeCurrentCwd}
              viewerLogin={viewerLogin}
              isBacklog={tab === 'backlog'}
              searching={query.trim().length > 0}
              expandedOther={expandedOther}
              collapsedStatuses={collapsedStatuses}
              onToggleOther={(cwd) => {
                setExpandedOther((current) => toggleSetMember(current, comparablePath(cwd)));
              }}
              onToggleStatus={(key) => {
                setCollapsedStatuses((current) => toggleSetMember(current, key));
              }}
              selectedCwd={selectedCwd}
              selectedNumber={selectedNumber}
              focusedKey={focusedKey}
              backlogIds={backlogIds}
              repoErrors={scopedRepoErrors}
              onSelect={onSelect}
              onToggleBacklog={onToggleBacklog}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
