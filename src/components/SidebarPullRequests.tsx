import { useSidebarPagination } from '../hooks/useSidebarPagination';
import { useState, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
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
        <p className="px-3 py-1 text-[11px] leading-relaxed text-droid-text-muted">
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
              className="group/heading flex w-full cursor-pointer items-center gap-2.5 rounded-md py-1.5 pl-3 pr-3 text-left text-[13px] font-medium text-droid-text-secondary transition-colors hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/40"
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
                  className={`h-3 w-3 shrink-0 opacity-50 transition-[transform,opacity] group-hover/heading:opacity-100 ${open ? 'rotate-90' : ''}`}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </span>
              <span className="shrink-0 text-[11px] font-normal text-droid-text-muted">
                {prKindLabel(kind)}
              </span>
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
