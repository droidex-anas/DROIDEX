import { useSidebarPagination } from '../hooks/useSidebarPagination';
import { useState, type ReactNode } from 'react';
import { LayoutGroup, MotionConfig, motion } from 'framer-motion';
import type { SessionSummary } from '../types/bridge';
import { ACTIVITY_GROUPS, type SessionActivityStatus } from '../lib/sidebarActivity';
import { SidebarSectionHeading } from './SidebarSectionHeading';
import { SidebarSessionList } from './SidebarSessionList';

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
  // A chat that changes state moves to another group. The groups are separate
  // lists, so the row would unmount in one and mount in the other and read as
  // a blink; a shared layout id lets it glide to its new place instead
  // (position only: 250ms on the smooth-out curve, the skill's token for a
  // position change), and the rows around it close the gap the same way.
  const renderMovingRow = (session: SessionSummary) => (
    <motion.div
      key={session.appSessionId}
      layoutId={`inbox-${session.appSessionId}`}
      layout="position"
      transition={{ layout: { duration: 0.25, ease: [0.22, 1, 0.36, 1] } }}
    >
      {renderRow(session)}
    </motion.div>
  );
  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup id="sidebar-inbox">
        <div className="space-y-3">
          {sessions.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-droid-text-muted">
              {hiddenCount > 0 ? 'Nothing to show right now.' : 'No tasks match this view.'}
            </p>
          )}
          {ACTIVITY_GROUPS.map((group) => {
            const rows = sessions.filter((session) => group.statuses.includes(statusFor(session)));
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
            <p className="px-3 pt-1 text-[11px] text-droid-text-muted/70">
              {String(hiddenCount)} older {hiddenCount === 1 ? 'chat lives' : 'chats live'} in
              Workspaces.
            </p>
          )}
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
