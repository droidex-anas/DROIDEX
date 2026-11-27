import { useMemo } from 'react';
import { ChevronRight } from '@droidex/icons';

import { CountBadge } from '../../../components/ui/Badge';
import { comparablePath } from '../../../lib/pathComparison';
import { prBacklogId } from '../lib/prBacklog';
import { groupByWorkflowStatus, prRowKey, type PrStatusGroup } from '../lib/prBoard';
import {
  inboxGroupIsExpanded,
  isCurrentInboxGroup,
  type InboxPullRequest,
  type InboxRepoGroup,
} from '../lib/prInbox';
import type { InboxRepoError } from '../lib/prListState';
import { FoldChevron, PrCollapse } from './PrCollapse';
import { PrInboxRow } from './PrInboxRow';

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

function SkeletonRows() {
  return (
    <div className="space-y-1.5 px-3 pt-2">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="h-11 rounded-lg bg-surface" />
      ))}
    </div>
  );
}

function StatusGroupSection({
  group,
  collapsed,
  showHeader,
  showRepo,
  selectedCwd,
  selectedNumber,
  focusedKey,
  backlogIds,
  onToggleCollapse,
  onSelect,
  onToggleBacklog,
}: {
  group: PrStatusGroup;
  collapsed: boolean;
  showHeader: boolean;
  showRepo: boolean;
  selectedCwd: string | null;
  selectedNumber: number | null;
  focusedKey: string | null;
  backlogIds: ReadonlySet<string>;
  onToggleCollapse: () => void;
  onSelect: (pr: InboxPullRequest) => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  const rows = (
    <div className="space-y-0.5">
      {group.prs.map((pr) => {
        const key = prRowKey(pr);
        return (
          <PrInboxRow
            key={key}
            pr={pr}
            selected={rowIsSelected(pr, selectedCwd, selectedNumber)}
            focused={focusedKey === key}
            backlogged={backlogIds.has(prBacklogId(pr))}
            showRepo={showRepo}
            onSelect={onSelect}
            onToggleBacklog={onToggleBacklog}
          />
        );
      })}
    </div>
  );

  if (!showHeader) return rows;

  return (
    <div className="space-y-1">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={onToggleCollapse}
        className="group flex w-full select-none items-center gap-2 rounded-lg px-3 py-1.5 text-left text-muted transition-colors duration-quick hover:bg-surface hover:text-secondary"
      >
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${group.dotClass}`} />
        <span className="text-label text-secondary">{group.label}</span>
        <CountBadge size="sm">{group.prs.length}</CountBadge>
        <span className="ml-auto">
          <FoldChevron open={!collapsed} />
        </span>
      </button>
      <PrCollapse open={!collapsed}>{rows}</PrCollapse>
    </div>
  );
}

function RepoPrList({
  prs,
  viewerLogin,
  isBacklog,
  showRepo,
  collapsedGroups,
  onToggleStatusGroup,
  selectedCwd,
  selectedNumber,
  focusedKey,
  backlogIds,
  onSelect,
  onToggleBacklog,
}: {
  prs: InboxPullRequest[];
  viewerLogin: string | null;
  isBacklog: boolean;
  showRepo: boolean;
  collapsedGroups: ReadonlySet<string>;
  onToggleStatusGroup: (id: string) => void;
  selectedCwd: string | null;
  selectedNumber: number | null;
  focusedKey: string | null;
  backlogIds: ReadonlySet<string>;
  onSelect: (pr: InboxPullRequest) => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  const statusGroups = useMemo(
    () => groupByWorkflowStatus(prs, viewerLogin, isBacklog),
    [isBacklog, prs, viewerLogin],
  );
  const showHeaders = statusGroups.length > 1 || (statusGroups.length === 1 && prs.length > 2);

  return (
    <div className="space-y-4">
      {statusGroups.map((statusGroup) => (
        <StatusGroupSection
          key={statusGroup.id}
          group={statusGroup}
          collapsed={collapsedGroups.has(statusGroup.id)}
          showHeader={showHeaders}
          showRepo={showRepo}
          selectedCwd={selectedCwd}
          selectedNumber={selectedNumber}
          focusedKey={focusedKey}
          backlogIds={backlogIds}
          onToggleCollapse={() => {
            onToggleStatusGroup(statusGroup.id);
          }}
          onSelect={onSelect}
          onToggleBacklog={onToggleBacklog}
        />
      ))}
    </div>
  );
}

export function PrInboxGroups({
  loading,
  error,
  emptyCopy,
  currentEmptyCopy,
  groups,
  currentCwd,
  viewerLogin,
  isBacklog,
  searching,
  expandedOther,
  collapsedStatuses,
  onToggleOther,
  onToggleStatus,
  selectedCwd,
  selectedNumber,
  focusedKey,
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
  viewerLogin: string | null;
  isBacklog: boolean;
  searching: boolean;
  expandedOther: ReadonlySet<string>;
  collapsedStatuses: ReadonlySet<string>;
  onToggleOther: (cwd: string) => void;
  onToggleStatus: (key: string) => void;
  selectedCwd: string | null;
  selectedNumber: number | null;
  focusedKey: string | null;
  backlogIds: ReadonlySet<string>;
  repoErrors: InboxRepoError[];
  onSelect: (pr: InboxPullRequest) => void;
  onToggleBacklog: (pr: InboxPullRequest) => void;
}) {
  if (loading) return <SkeletonRows />;
  if (groups.length === 0) {
    return error ? null : (
      <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
        <p className="text-body text-muted">{emptyCopy}</p>
      </div>
    );
  }
  const errorByCwd = new Map(repoErrors.map((item) => [comparablePath(item.cwd), item] as const));
  return (
    <div className="space-y-5">
      {groups.map((group) => {
        const current = isCurrentInboxGroup(group.cwd, currentCwd);
        const expanded = inboxGroupIsExpanded({
          cwd: group.cwd,
          currentCwd,
          expandedOther,
          searching,
          selectedCwd,
        });
        const repoKey = comparablePath(group.cwd);
        const repoError = errorByCwd.get(repoKey);
        const scopedCollapsed = new Set(
          [...collapsedStatuses]
            .filter((entry) => entry.startsWith(`${repoKey}:`))
            .map((entry) => entry.slice(repoKey.length + 1)),
        );
        const list = (
          <RepoPrList
            prs={group.prs}
            viewerLogin={viewerLogin}
            isBacklog={isBacklog}
            showRepo={false}
            collapsedGroups={scopedCollapsed}
            onToggleStatusGroup={(statusId) => {
              onToggleStatus(`${repoKey}:${statusId}`);
            }}
            selectedCwd={selectedCwd}
            selectedNumber={selectedNumber}
            focusedKey={focusedKey}
            backlogIds={backlogIds}
            onSelect={onSelect}
            onToggleBacklog={onToggleBacklog}
          />
        );
        if (current) {
          return (
            <section key={group.cwd}>
              {repoError ? (
                <p className="px-3 pb-2 text-caption text-muted">{repoError.message}</p>
              ) : null}
              {group.prs.length === 0 && !repoError ? (
                <p className="px-3 py-8 text-body text-muted">{currentEmptyCopy}</p>
              ) : (
                list
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
              className="flex w-full select-none items-center gap-2 rounded-lg px-3 py-2 text-left text-muted transition-colors duration-quick hover:bg-surface hover:text-secondary"
            >
              <ChevronRight
                aria-hidden="true"
                className={`size-icon-sm shrink-0 transition-transform duration-fast ease-smooth-out ${expanded ? 'rotate-90' : ''}`}
              />
              <span className="min-w-0 truncate text-label text-secondary">{group.repoName}</span>
              {group.prs.length > 0 ? (
                <CountBadge size="sm" className="ml-auto">
                  {group.prs.length}
                </CountBadge>
              ) : null}
            </button>
            <PrCollapse open={expanded}>
              <div className="mt-1">
                {repoError ? (
                  <p className="px-3 pb-2 text-caption text-muted">{repoError.message}</p>
                ) : null}
                {list}
              </div>
            </PrCollapse>
          </section>
        );
      })}
    </div>
  );
}
