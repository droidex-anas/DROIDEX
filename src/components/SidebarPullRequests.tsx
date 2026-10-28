import { useSidebarPagination } from '../hooks/useSidebarPagination';
import { useState, type ReactNode } from 'react';
import { ChevronRight } from '@droidex/icons';
import type { SessionSummary } from '../types/bridge';
import type { ChatMetadataMap, ChatPullRequest } from '../lib/chatMetadata';
import { prKind, prKindLabel } from '../lib/github';
import { PrStateIcon } from './environment/GithubIcons';
import { SidebarSectionHeading } from './SidebarSectionHeading';
import { SidebarSessionList } from './SidebarSessionList';

// PR urls key the other groups, so this cannot collide with one.
const UNLINKED = 'unlinked';

interface Props {
  sessions: SessionSummary[];
  metadata: Partial<ChatMetadataMap>;
  activeAppSessionId: string | null;
  renderRow: (session: SessionSummary) => ReactNode;
  limit: number;
}

export function SidebarPullRequests({
  sessions,
  metadata,
  activeAppSessionId,
  renderRow,
  limit,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { defaultVisibleCount, visibleCountFor, showMore, showLess } = useSidebarPagination(limit);
  const toggle = (key: string) => {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsed(next);
  };
  const groups = new Map<string, { pr: ChatPullRequest; sessions: SessionSummary[] }>();
  const unlinked: SessionSummary[] = [];
  for (const session of sessions) {
    const links = metadata[session.appSessionId]?.pullRequests ?? [];
    if (links.length === 0) unlinked.push(session);
    for (const pr of links) {
      const group = groups.get(pr.url) ?? { pr, sessions: [] };
      group.sessions.push(session);
      groups.set(pr.url, group);
    }
  }
  const list = (key: string, rows: SessionSummary[]) => (
    <SidebarSessionList
      sessions={rows}
      activeAppSessionId={activeAppSessionId}
      renderRow={renderRow}
      visibleCount={visibleCountFor(key)}
      defaultVisibleCount={defaultVisibleCount}
      onShowMore={() => {
        showMore(key);
      }}
      onShowLess={() => {
        showLess(key);
      }}
    />
  );
  return (
    <div className="space-y-3">
      {groups.size === 0 && (
        <p className="px-3 py-1 text-caption text-muted">
          Pull requests are linked automatically from your chats’ worktrees.
        </p>
      )}
      {[...groups].map(([url, { pr, sessions: rows }]) => {
        const open = !collapsed.has(url);
        const kind = prKind(pr);
        return (
          <section key={url} aria-label={`PR #${String(pr.number)} ${pr.title}`}>
            <button
              type="button"
              className="group/heading flex w-full cursor-pointer items-center gap-2.5 rounded-sm px-3 py-1.5 text-left text-body-strong text-secondary transition-colors hover:text-primary"
              title={`${url} · ${prKindLabel(kind)} (last detected)`}
              aria-expanded={open}
              onClick={() => {
                toggle(url);
              }}
            >
              <PrStateIcon kind={kind} size={14} checks={pr.checks} />
              <span className="flex min-w-0 flex-1 items-center gap-1">
                <span className="truncate">
                  #{pr.number} {pr.title}
                </span>
                <ChevronRight
                  className={`size-icon-sm shrink-0 opacity-50 transition group-hover/heading:opacity-100 ${open ? 'rotate-90' : ''}`}
                />
              </span>
              <span className="shrink-0 text-caption text-muted">{prKindLabel(kind)}</span>
            </button>
            {open && list(url, rows)}
          </section>
        );
      })}
      {unlinked.length > 0 && (
        <section aria-label="No linked PR">
          <SidebarSectionHeading
            label="No linked PR"
            open={!collapsed.has(UNLINKED)}
            count={unlinked.length}
            onToggle={() => {
              toggle(UNLINKED);
            }}
          />
          {!collapsed.has(UNLINKED) && list(UNLINKED, unlinked)}
        </section>
      )}
    </div>
  );
}
