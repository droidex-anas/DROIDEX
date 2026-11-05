import type { ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SIDEBAR_VISIBLE_SESSION_LIMIT } from '../lib/workspaces';
import type { SessionSummary } from '../types/bridge';

export interface SidebarSessionListProps {
  sessions: SessionSummary[];
  /** Rows to show before "Show more"; owned by the section, not this list. */
  visibleCount: number;
  defaultVisibleCount?: number;
  activeAppSessionId: string | null;
  renderRow: (session: SessionSummary) => ReactNode;
  onShowMore: () => void;
  onShowLess: () => void;
  /** Pre-existing Droid sessions this folder has that were never sent. */
  earlierSessionCount?: number;
  onShowEarlier?: () => void;
}

const CONTROL_CLASS = 'text-label text-muted hover:text-primary transition-colors';

// The order of the chats across a view's lists. Rows glide only when it
// changes: selecting a chat or paging a list shifts rows without changing it,
// and those shifts stay instant, as switching chats must.
export function sidebarOrder(lists: readonly SessionSummary[][]): string {
  return lists
    .map((sessions) => sessions.map((session) => session.appSessionId).join(' '))
    .join('\n');
}

// A chat that moves, re-sorted when it starts working or carried to another
// section, glides to its new place (position only, 250ms on the smooth-out
// curve) and the rows around it close the gap the same way; one layout id lets
// it travel between lists. A chat created while the list is on screen fades in
// where it lands.
export function SidebarMovingRow({
  layoutId,
  order,
  arriving,
  children,
}: {
  layoutId: string;
  order: string;
  arriving: boolean;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      layoutId={reduceMotion ? undefined : layoutId}
      layout={reduceMotion ? false : 'position'}
      layoutDependency={order}
      initial={arriving ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

// Shows the latest sessions and tucks the rest behind "Show more". A folder
// that also has older pre-existing Droid sessions the sidecar withheld offers
// to load them once everything already loaded is on screen.
export function SidebarSessionList({
  sessions,
  visibleCount,
  defaultVisibleCount = SIDEBAR_VISIBLE_SESSION_LIMIT,
  activeAppSessionId,
  renderRow,
  onShowMore,
  onShowLess,
  earlierSessionCount = 0,
  onShowEarlier,
}: SidebarSessionListProps) {
  const count = Math.min(visibleCount, sessions.length);
  let visible = sessions.slice(0, count);
  // Keep the active session visible even if it sits below the paged window so
  // selecting an older chat never hides it on the next render.
  const active = activeAppSessionId
    ? sessions.find((session) => session.appSessionId === activeAppSessionId)
    : undefined;
  if (active && !visible.includes(active)) visible = [...visible, active];

  const remaining = sessions.length - count;
  const isExpanded = count > defaultVisibleCount;
  // Revealing also pages the window forward, otherwise the newly loaded
  // sessions land below it and the click looks like it did nothing.
  const showEarlier =
    remaining === 0 && earlierSessionCount > 0 && onShowEarlier
      ? () => {
          onShowEarlier();
          onShowMore();
        }
      : undefined;

  return (
    <div className="mt-0.5 space-y-0.5">
      {visible.map(renderRow)}
      {(remaining > 0 || isExpanded || showEarlier) && (
        <div className="flex items-center gap-3 pl-3 pr-2 pt-0.5">
          {remaining > 0 && (
            <button onClick={onShowMore} className={CONTROL_CLASS}>
              Show more
            </button>
          )}
          {isExpanded && (
            <button onClick={onShowLess} className={CONTROL_CLASS}>
              Show less
            </button>
          )}
          {showEarlier && (
            <button
              onClick={showEarlier}
              title="Load older Droid sessions already in this folder"
              className={CONTROL_CLASS}
            >
              Show {earlierSessionCount} earlier
            </button>
          )}
        </div>
      )}
    </div>
  );
}
