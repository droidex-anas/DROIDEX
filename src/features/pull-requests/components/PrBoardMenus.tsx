import { useRef, useState } from 'react';
import { Check, ChevronDown, ListFilter, X } from '@droidex/icons';

import { GitHubMarkIcon } from '../../../components/environment/GithubIcons';
import { CountBadge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { Menu } from '../../../components/ui/Menu';
import { comparablePath } from '../../../lib/pathComparison';
import { workspaceName } from '../../../lib/workspaces';
import {
  PR_QUICK_FILTERS,
  PR_SORT_OPTIONS,
  type PrQuickFilter,
  type PrSortOrder,
} from '../lib/prBoard';
import type { InboxPullRequest } from '../lib/prInbox';
import type { InboxRepoError } from '../lib/prListState';

export interface RepoOption {
  cwd: string;
  repoName: string;
  count: number;
}

export function collectRepoOptions(
  currentCwd: string | null,
  prs: readonly InboxPullRequest[],
  repoErrors: readonly InboxRepoError[],
): RepoOption[] {
  const map = new Map<string, RepoOption>();
  if (currentCwd) {
    map.set(comparablePath(currentCwd), {
      cwd: currentCwd,
      repoName: workspaceName(currentCwd),
      count: 0,
    });
  }
  for (const pr of prs) {
    const key = comparablePath(pr.cwd);
    const existing = map.get(key);
    if (existing) existing.count += 1;
    else map.set(key, { cwd: pr.cwd, repoName: pr.repoName, count: 1 });
  }
  for (const item of repoErrors) {
    const key = comparablePath(item.cwd);
    if (!map.has(key)) map.set(key, { cwd: item.cwd, repoName: item.repoName, count: 0 });
  }
  return [...map.values()];
}

function repoScopeLabel(repos: readonly RepoOption[], activeRepo: RepoOption | null): string {
  if (repos.length === 1) return repos[0].repoName;
  return activeRepo ? activeRepo.repoName : 'All repositories';
}

export function RepoScopeMenu({
  repos,
  repoScope,
  onSelect,
}: {
  repos: RepoOption[];
  repoScope: string | null;
  onSelect: (cwd: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (repos.length === 0) return null;

  const activeRepo = repoScope
    ? (repos.find((repo) => comparablePath(repo.cwd) === comparablePath(repoScope)) ?? null)
    : null;
  const label = repoScopeLabel(repos, activeRepo);

  if (repos.length === 1) {
    return (
      <span className="inline-flex h-control-sm items-center gap-1.5 rounded-full bg-surface px-2.5 text-label text-secondary">
        <GitHubMarkIcon size={13} className="shrink-0 text-muted" />
        <span className="max-w-44 truncate">{label}</span>
      </span>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Filter by repository"
        onClick={() => {
          setOpen((value) => !value);
        }}
        className="inline-flex h-control-sm select-none items-center gap-1.5 rounded-full bg-surface px-2.5 text-label text-secondary transition-colors duration-quick hover:bg-elevated hover:text-primary"
      >
        <GitHubMarkIcon size={13} className="shrink-0 text-muted" />
        <span className="max-w-44 truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0 text-muted" aria-hidden="true" />
      </button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={triggerRef}
        placement="bottom-start"
        label="Repository filter"
        width={240}
      >
        <Menu.Item
          role="menuitemradio"
          aria-checked={repoScope === null}
          icon={repoScope === null ? Check : undefined}
          onSelect={() => {
            onSelect(null);
          }}
        >
          <span
            className={
              repoScope === null ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 truncate pl-6'
            }
          >
            All repositories
          </span>
        </Menu.Item>
        <Menu.Divider />
        {repos.map((repo) => {
          const checked =
            repoScope !== null && comparablePath(repoScope) === comparablePath(repo.cwd);
          return (
            <Menu.Item
              key={repo.cwd}
              role="menuitemradio"
              aria-checked={checked}
              icon={checked ? Check : undefined}
              onSelect={() => {
                onSelect(repo.cwd);
              }}
            >
              <span
                className={checked ? 'min-w-0 flex-1 truncate' : 'min-w-0 flex-1 truncate pl-6'}
              >
                {repo.repoName}
              </span>
              {repo.count > 0 ? <CountBadge size="sm">{repo.count}</CountBadge> : null}
            </Menu.Item>
          );
        })}
      </Menu>
    </>
  );
}

export function PrFilterMenu({
  quickFilter,
  sort,
  onQuickFilterChange,
  onSortChange,
}: {
  quickFilter: PrQuickFilter;
  sort: PrSortOrder;
  onQuickFilterChange: (next: PrQuickFilter) => void;
  onSortChange: (next: PrSortOrder) => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeCount = (quickFilter !== 'all' ? 1 : 0) + (sort !== 'priority' ? 1 : 0);
  const activeFilterLabel =
    quickFilter !== 'all'
      ? (PR_QUICK_FILTERS.find((item) => item.id === quickFilter)?.label ?? null)
      : null;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        ref={triggerRef}
        variant={activeCount > 0 ? 'secondary' : 'ghost'}
        size="sm"
        icon={ListFilter}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Filter
        {activeCount > 0 ? (
          <CountBadge size="sm" tone="active">
            {activeCount}
          </CountBadge>
        ) : null}
      </Button>
      {activeFilterLabel ? (
        <button
          type="button"
          onClick={() => {
            onQuickFilterChange('all');
          }}
          aria-label={`Clear ${activeFilterLabel} filter`}
          className="inline-flex h-control-sm select-none items-center gap-1 rounded-md bg-elevated px-2 text-caption text-secondary transition-colors duration-quick hover:bg-active hover:text-primary"
        >
          <span>{activeFilterLabel}</span>
          <X className="size-3 shrink-0 text-muted" aria-hidden="true" />
        </button>
      ) : null}
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={triggerRef}
        placement="bottom-start"
        label="Filter and sort pull requests"
        width={220}
      >
        <Menu.Label>Status</Menu.Label>
        {PR_QUICK_FILTERS.map((item) => {
          const checked = quickFilter === item.id;
          return (
            <Menu.Item
              key={item.id}
              role="menuitemradio"
              aria-checked={checked}
              icon={checked ? Check : undefined}
              onSelect={() => {
                onQuickFilterChange(item.id);
              }}
            >
              <span className={checked ? '' : 'pl-6'}>{item.label}</span>
            </Menu.Item>
          );
        })}
        <Menu.Divider />
        <Menu.Label>Sort by</Menu.Label>
        {PR_SORT_OPTIONS.map((item) => {
          const checked = sort === item.id;
          return (
            <Menu.Item
              key={item.id}
              role="menuitemradio"
              aria-checked={checked}
              icon={checked ? Check : undefined}
              onSelect={() => {
                onSortChange(item.id);
              }}
            >
              <span className={checked ? '' : 'pl-6'}>{item.label}</span>
            </Menu.Item>
          );
        })}
      </Menu>
    </div>
  );
}
