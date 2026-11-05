import { useSidebarPagination } from '../hooks/useSidebarPagination';
import { useState, type ReactNode } from 'react';
import { LayoutGroup, MotionConfig } from 'framer-motion';
import type { SessionSummary } from '../types/bridge';
import { ACTIVITY_GROUPS, type SessionActivityStatus } from '../lib/sidebarActivity';
import { SidebarSectionHeading } from './SidebarSectionHeading';
import { SidebarMovingRow, SidebarSessionList, sidebarOrder } from './SidebarSessionList';

interface Props {
  sessions: SessionSummary[];
  activeAppSessionId: string | null;
  statusFor: (session: SessionSummary) => SessionActivityStatus;
  renderRow: (session: SessionSummary) => ReactNode;
  limit: number;
  showSettled: boolean;
  // Chats aged out of the inbox; they stay reachable from Workspaces.
  hiddenCount: number;
}

// An inbox: chats grouped by what they need from the user, most urgent first.
// Rows and chat actions are shared with workspace browsing.
export function SidebarActivity({
  sessions,
  activeAppSessionId,
  statusFor,
  renderRow,
  limit,
  showSettled,
  hiddenCount,
}: Props) {
  const [openGroups, setOpenGroups] = useState<Partial<Record<string, boolean>>>({});
  const { defaultVisibleCount, visibleCountFor, showMore, showLess } = useSidebarPagination(limit);
  const [shownAt] = useState(Date.now);
  const groups = ACTIVITY_GROUPS.map((group) => ({
    group,
    rows: sessions.filter((session) => group.statuses.includes(statusFor(session))),
  }));
  const order = sidebarOrder(groups.map(({ rows }) => rows));
  // A chat that changes state moves to another group. The groups are separate
  // lists, so the row would unmount in one and mount in the other and read as
  // a blink; a shared layout id lets it glide to its new place instead.
  const renderMovingRow = (session: SessionSummary) => (
    <SidebarMovingRow
      key={session.appSessionId}
      layoutId={`inbox-${session.appSessionId}`}
      order={order}
      arriving={session.createdAt > shownAt}
    >
      {renderRow(session)}
    </SidebarMovingRow>
  );
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="sidebar-inbox">
        <div className="space-y-3">
          {sessions.length === 0 && (
            <p className="px-3 py-2 text-caption text-muted">
              {hiddenCount > 0 ? 'Nothing to show right now.' : 'No tasks match this view.'}
            </p>
          )}
          {groups.map(({ group, rows }) => {
            if (rows.length === 0) return null;
            // Settled starts folded away unless the view asks to show it.
            const open = openGroups[group.label] ?? (group.label !== 'Settled' || showSettled);
            return (
              <section key={group.label} aria-label={group.label}>
                <SidebarSectionHeading
                  label={group.label}
                  open={open}
                  count={rows.length}
                  onToggle={() => {
                    setOpenGroups({ ...openGroups, [group.label]: !open });
                  }}
                />
                {open && (
                  <SidebarSessionList
                    sessions={rows}
                    activeAppSessionId={activeAppSessionId}
                    visibleCount={visibleCountFor(group.label)}
                    defaultVisibleCount={defaultVisibleCount}
                    renderRow={renderMovingRow}
                    onShowMore={() => {
                      showMore(group.label);
                    }}
                    onShowLess={() => {
                      showLess(group.label);
                    }}
                  />
                )}
              </section>
            );
          })}
          {hiddenCount > 0 && (
            <p className="px-3 pt-1 text-caption text-muted/70">
              {String(hiddenCount)} older {hiddenCount === 1 ? 'chat lives' : 'chats live'} in
              Workspaces.
            </p>
          )}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
