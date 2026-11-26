import { useMemo, useState, type KeyboardEvent } from 'react';
import { ChevronRight, GitBranch, ListTodo, RefreshCw, Search, Undo } from '@droidex/icons';

import { PrStateIcon } from '../../../components/environment/GithubIcons';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { comparablePath } from '../../../lib/pathComparison';
import { prKind } from '../../../lib/github';
import { workspaceName } from '../../../lib/workspaces';
import {
  attachInboxRepoErrors,
  ensureCurrentInboxGroup,
  filterPullRequests,
  groupInboxPullRequests,
  inboxGroupIsExpanded,
  isCurrentInboxGroup,
  orderInboxGroups,
  prInboxEmptyCopy,
  searchPullRequests,
  type InboxPullRequest,
  type InboxRepoGroup,
  type PrInboxTab,
} from '../lib/prInbox';
import { prBacklogId } from '../lib/prBacklog';
import { sortInboxPullRequests } from '../lib/prPriority';
import { arrowKeyTab } from '../lib/prTabs';
import type { InboxRepoError } from '../lib/prListState';
import { displayLogin } from '../lib/prIdentity';
import { prAbsoluteTime, prRelativeTime } from '../lib/prTime';
import { GithubAvatar } from './GithubAvatar';

const TABS: { id: PrInboxTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reviewing', label: 'Reviewing' },
  { id: 'authored', label: 'Authored' },
  { id: 'backlog', label: 'Backlog' },
];

const TAB_PANEL_ID = 'pull-request-filter-tabpanel';

function tabId(tab: PrInboxTab): string {
  return `pull-request-filter-${tab}-tab`;
}

function rowIsSelected(
  pr: InboxPullRequest,
  selectedCwd: string | null,
  selectedNumber: number | null,
): boolean {
  return (
    selectedNumber === pr.number &&
    selectedCwd != null &&
    comparablePath(selectedCwd) === comparablePath(pr.cwd)
  );
}

function PrInboxRow({
  pr,
  selected,
  backlogged,
  onSelect,
  onToggleBacklog,
}: {
  pr: InboxPullRequest;
  selected: boolean;
  backlogged: boolean;
  onSelect: (pr: InboxPullRequest) => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  const time = prRelativeTime(pr.updatedAt ?? pr.createdAt);
  return (
    <div
      className={`group flex w-full items-start gap-1 rounded-lg pr-1 transition-colors hover:bg-active ${
        selected ? 'bg-active' : ''
      }`}
    >
      <button
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={() => {
          onSelect(pr);
        }}
        className="flex min-w-0 flex-1 items-start gap-2.5 px-2.5 py-2 text-left"
      >
        <span className="mt-0.5 shrink-0">
          <PrStateIcon kind={prKind(pr)} size={16} checks={pr.checks} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span title={pr.title} className="min-w-0 truncate text-body-strong text-primary">
              {pr.title}
            </span>
            {time ? (
              <span
                title={prAbsoluteTime(pr.updatedAt ?? pr.createdAt)}
                className="shrink-0 text-caption text-muted"
              >
                {time}
              </span>
            ) : null}
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-caption text-muted">
            <GithubAvatar login={pr.author} size={16} />
            <span className="shrink-0 text-secondary">{displayLogin(pr.author)}</span>
            <span className="shrink-0 tabular-nums">#{pr.number}</span>
            {pr.headRefName ? (
              <>
                <GitBranch className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">
                  {pr.baseRefName ? `${pr.baseRefName} ← ` : ''}
                  {pr.headRefName}
                </span>
              </>
            ) : null}
          </span>
          <span className="mt-1 block text-caption tabular-nums">
            <span style={{ color: 'var(--diff-add-fg)' }}>+{pr.additions}</span>{' '}
            <span style={{ color: 'var(--diff-del-fg)' }}>−{pr.deletions}</span>
          </span>
        </span>
      </button>
      <button
        type="button"
        title={backlogged ? 'Restore from backlog' : 'Move to backlog'}
        aria-label={backlogged ? 'Restore from backlog' : 'Move to backlog'}
        onClick={() => {
          onToggleBacklog(pr);
        }}
        className="mt-1.5 flex size-control-sm shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity duration-quick group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-elevated hover:text-primary"
      >
        {backlogged ? (
          <Undo className="size-icon-sm" aria-hidden="true" />
        ) : (
          <ListTodo className="size-icon-sm" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

function SkeletonRows() {
  return (
    <div className="space-y-1">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-16 rounded-lg bg-elevated/40" />
      ))}
    </div>
  );
}

function InboxRows({
  prs,
  selectedCwd,
  selectedNumber,
  backlogIds,
  onSelect,
  onToggleBacklog,
}: {
  prs: InboxPullRequest[];
  selectedCwd: string | null;
  selectedNumber: number | null;
  backlogIds: ReadonlySet<string>;
  onSelect: (pr: InboxPullRequest) => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  return (
    <div className="space-y-0.5">
      {prs.map((pr) => (
        <PrInboxRow
          key={`${pr.cwd}:${String(pr.number)}`}
          pr={pr}
          selected={rowIsSelected(pr, selectedCwd, selectedNumber)}
          backlogged={backlogIds.has(prBacklogId(pr))}
          onSelect={onSelect}
          onToggleBacklog={onToggleBacklog}
        />
      ))}
    </div>
  );
}

function InboxList({
  loading,
  error,
  emptyCopy,
  currentEmptyCopy,
  groups,
  currentCwd,
  searching,
  expandedOther,
  onToggleOther,
  selectedCwd,
  selectedNumber,
  backlogIds,
  repoErrors,
  onSelect,
  onToggleBacklog,
}: {
  loading: boolean;
  error: string | null;
  emptyCopy: string;
  currentEmptyCopy: string;
  groups: InboxRepoGroup[];
  currentCwd: string | null;
  searching: boolean;
  expandedOther: ReadonlySet<string>;
  onToggleOther: (cwd: string) => void;
  selectedCwd: string | null;
  selectedNumber: number | null;
  backlogIds: ReadonlySet<string>;
  repoErrors: InboxRepoError[];
  onSelect: (pr: InboxPullRequest) => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  if (loading) return <SkeletonRows />;
  if (groups.length === 0) {
    return error ? null : <p className="px-1 py-6 text-body text-muted">{emptyCopy}</p>;
  }
  const errorByCwd = new Map(repoErrors.map((item) => [comparablePath(item.cwd), item] as const));
  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const current = isCurrentInboxGroup(group.cwd, currentCwd);
        const expanded = inboxGroupIsExpanded({
          cwd: group.cwd,
          currentCwd,
          expandedOther,
          searching,
          selectedCwd,
        });
        const repoError = errorByCwd.get(comparablePath(group.cwd));
        const rows = (
          <InboxRows
            prs={group.prs}
            selectedCwd={selectedCwd}
            selectedNumber={selectedNumber}
            backlogIds={backlogIds}
            onSelect={onSelect}
            onToggleBacklog={onToggleBacklog}
          />
        );
        if (current) {
          return (
            <section key={group.cwd}>
              {repoError ? (
                <p className="px-1 pb-2 text-caption text-muted">{repoError.message}</p>
              ) : null}
              {group.prs.length === 0 && !repoError ? (
                <p className="px-1 py-4 text-body text-muted">{currentEmptyCopy}</p>
              ) : (
                rows
              )}
            </section>
          );
        }
        return (
          <section key={group.cwd}>
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? 'Hide' : 'Show'} ${group.repoName} pull requests`}
              onClick={() => {
                onToggleOther(group.cwd);
              }}
              className="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-left text-muted transition-colors hover:bg-active hover:text-secondary"
            >
              <ChevronRight
                aria-hidden="true"
                className={`size-icon-sm shrink-0 transition-transform duration-fast ease-smooth-out ${expanded ? 'rotate-90' : ''}`}
              />
              <span className="min-w-0 truncate text-label">{group.repoName}</span>
              {group.prs.length > 0 ? (
                <span className="ml-auto shrink-0 text-caption tabular-nums opacity-60">
                  {group.prs.length}
                </span>
              ) : null}
            </button>
            {expanded ? (
              <div className="mt-1">
                {repoError ? (
                  <p className="px-1 pb-2 text-caption text-muted">{repoError.message}</p>
                ) : null}
                {rows}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
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
  onSelect: (pr: InboxPullRequest) => void;
  onRetry: () => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  const [tab, setTab] = useState<PrInboxTab>('all');
  const [query, setQuery] = useState('');
  const [expandedOther, setExpandedOther] = useState<Set<string>>(() => new Set());
  const visible = useMemo(
    () =>
      searchPullRequests(
        sortInboxPullRequests(filterPullRequests(prs, tab, viewerLogin, backlogIds), viewerLogin),
        query,
      ),
    [backlogIds, prs, query, tab, viewerLogin],
  );
  const tabCounts = useMemo(() => {
    const counts = new Map<PrInboxTab, number>();
    for (const item of TABS) {
      counts.set(item.id, filterPullRequests(prs, item.id, viewerLogin, backlogIds).length);
    }
    return counts;
  }, [backlogIds, prs, viewerLogin]);
  const groups = useMemo(
    () =>
      orderInboxGroups(
        ensureCurrentInboxGroup(
          attachInboxRepoErrors(groupInboxPullRequests(visible), repoErrors),
          currentCwd,
          currentCwd ? workspaceName(currentCwd) : '',
        ),
        currentCwd,
      ),
    [currentCwd, repoErrors, visible],
  );
  const showSkeleton = loading && prs.length === 0;
  const multiRepo = groups.length > 1 || repoErrors.length > 0;

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: PrInboxTab) => {
    const next = arrowKeyTab(TABS, current, event.key);
    if (!next) return;
    event.preventDefault();
    setTab(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <div className="flex h-full min-h-0 flex-col px-3 pt-3 pb-2">
      <div className="flex items-center gap-3 px-1">
        <div
          role="tablist"
          aria-label="Pull request filters"
          className="flex min-w-0 items-center gap-2.5"
        >
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              id={tabId(item.id)}
              aria-controls={TAB_PANEL_ID}
              tabIndex={tab === item.id ? 0 : -1}
              onKeyDown={(event) => {
                onTabKeyDown(event, item.id);
              }}
              onClick={() => {
                setTab(item.id);
              }}
              className={`shrink-0 text-body-strong transition-colors ${
                tab === item.id ? 'text-primary' : 'text-muted hover:text-secondary'
              }`}
            >
              {item.label}
              {(tabCounts.get(item.id) ?? 0) > 0 ? (
                <span aria-hidden="true" className="ml-1 text-caption tabular-nums text-muted">
                  {tabCounts.get(item.id)}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          icon={RefreshCw}
          loading={loading}
          onClick={onRetry}
          title="Refresh"
          aria-label="Refresh"
        />
      </div>

      <div className="relative mt-3">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-icon-sm -translate-y-1/2 text-muted"
        />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          aria-label="Search pull requests"
          placeholder="Search"
          className="pl-9"
        />
      </div>

      {error ? (
        <div className="mt-2 flex items-center gap-2 px-1 text-caption text-muted">
          <span className="min-w-0 flex-1">{error}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      <div
        role="tabpanel"
        id={TAB_PANEL_ID}
        aria-labelledby={tabId(tab)}
        className="pr-workspace-scroll mt-2 min-h-0 flex-1 overflow-y-auto"
      >
        <InboxList
          loading={showSkeleton}
          error={error}
          emptyCopy={prInboxEmptyCopy(tab, query, multiRepo)}
          currentEmptyCopy={prInboxEmptyCopy(tab, query)}
          groups={groups}
          currentCwd={currentCwd}
          searching={query.trim().length > 0}
          expandedOther={expandedOther}
          onToggleOther={(cwd) => {
            const key = comparablePath(cwd);
            setExpandedOther((current) => {
              const next = new Set(current);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            });
          }}
          selectedCwd={selectedCwd}
          selectedNumber={selectedNumber}
          backlogIds={backlogIds}
          repoErrors={repoErrors}
          onSelect={onSelect}
          onToggleBacklog={onToggleBacklog}
        />
      </div>
    </div>
  );
}
