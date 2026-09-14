import { useSidebarPagination } from '../hooks/useSidebarPagination';
import { useState, type ReactNode } from 'react';
import { LayoutGroup, MotionConfig, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import type { SessionSummary } from '../types/bridge';
import { ACTIVITY_GROUPS, type SessionActivityStatus } from '../lib/sidebarActivity';
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
  const [settledOpen, setSettledOpen] = useState(false);
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
            const isSettled = group.label === 'Settled';
            const open = !isSettled || settledOpen || showSettled;
            const heading = (
              <>
                <span className="flex-1">{group.label}</span>
                <span className="tabular-nums">{rows.length}</span>
              </>
            );
            return (
              <section key={group.label} aria-label={group.label}>
                {isSettled && !showSettled ? (
                  <button
                    onClick={() => {
                      setSettledOpen(!settledOpen);
                    }}
                    aria-expanded={open}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] font-medium text-droid-text-muted hover:text-droid-text"
                  >
                    <ChevronRight
                      className={`h-3 w-3 transition-transform ${open ? 'rotate-90' : ''}`}
                      strokeWidth={1.5}
                    />
                    {heading}
                  </button>
                ) : (
                  <h3 className="flex items-center gap-2 px-2 py-1 text-[11px] font-medium text-droid-text-muted">
                    {/* Empty chevron slot so static labels line up with the collapsible one. */}
                    <span className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {heading}
                  </h3>
                )}
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
