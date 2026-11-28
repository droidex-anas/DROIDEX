import { useSidebarPagination } from '../hooks/useSidebarPagination';
import { useId, useRef, useState, type ReactNode } from 'react';
import {
  AnimatePresence,
  motion,
  Reorder,
  useDragControls,
  useReducedMotion,
  type DragControls,
} from 'framer-motion';
import { FolderOpen, Plus } from '@droidex/icons';
import { Row } from './ui/Row';
import { Tooltip } from './ui/Tooltip';
import { SIDEBAR_VISIBLE_SESSION_LIMIT, type WorkspaceSection } from '../lib/workspaces';
import type { SessionSummary } from '@droidex/protocol';
import { SidebarSectionHeading } from './SidebarSectionHeading';
import { SidebarWorkspaceRow } from './SidebarWorkspaceRow';
import { SidebarMovingRow, SidebarSessionList, sidebarOrder } from './SidebarSessionList';

const EASE = [0.16, 1, 0.3, 1] as const;

// Animated expand/collapse for sidebar sections, no chrome. Reduced-motion
// users get an instantaneous toggle (zero-duration transitions, same pattern
// as SubagentsDock).
function Expand({ open, children }: { open: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2, ease: EASE }}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// Reorder owns the pointer gesture; the row owns how the grip looks and how
// Alt+Arrow moves it. Keeping the controls here gives every folder one stable
// drag identity without making the session rows inside it draggable.
function WorkspaceReorderItem({
  cwd,
  enabled,
  onCommit,
  children,
}: {
  cwd: string;
  enabled: boolean;
  onCommit: () => void;
  children: (dragControls: DragControls | undefined) => ReactNode;
}) {
  const dragControls = useDragControls();
  const reduceMotion = useReducedMotion();
  return (
    <Reorder.Item
      as="div"
      value={cwd}
      dragListener={false}
      dragControls={dragControls}
      layout="position"
      transition={reduceMotion ? { duration: 0 } : undefined}
      onDragEnd={onCommit}
      className="relative"
    >
      {children(enabled ? dragControls : undefined)}
    </Reorder.Item>
  );
}

interface Props {
  workspaces: WorkspaceSection[];
  chatSessions: SessionSummary[];
  pinnedSessions: SessionSummary[];
  isFiltered: boolean;
  activeAppSessionId: string | null;
  renderRow: (session: SessionSummary) => ReactNode;
  onAddWorkspace: () => Promise<void>;
  onNewChat: (cwd: string) => void;
  onRemoveWorkspace: (cwd: string) => void;
  onReorderWorkspaces: (cwds: string[]) => void;
  onShowEarlierSessions: (cwds: readonly string[]) => void;
  limit?: number;
}

// Owns expansion and pagination for the familiar workspace / pinned / chat lists.
export function SidebarWorkspaceList({
  workspaces,
  chatSessions,
  pinnedSessions,
  isFiltered,
  activeAppSessionId,
  renderRow,
  onAddWorkspace,
  onNewChat,
  onRemoveWorkspace,
  onReorderWorkspaces,
  onShowEarlierSessions,
  limit = SIDEBAR_VISIBLE_SESSION_LIMIT,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { defaultVisibleCount, visibleCountFor, showMore, showLess } = useSidebarPagination(limit);
  const [shownAt] = useState(Date.now);
  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const reorderHelpId = useId();
  const canReorder = !isFiltered && workspaces.length > 1;
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const dragOrderRef = useRef<string[] | null>(null);
  const previewReorder = (cwds: string[]) => {
    dragOrderRef.current = cwds;
    setDragOrder(cwds);
  };
  const commitReorder = () => {
    const ordered = dragOrderRef.current;
    dragOrderRef.current = null;
    setDragOrder(null);
    if (ordered) onReorderWorkspaces(ordered);
  };
  const orderedWorkspaces = dragOrder
    ? dragOrder.flatMap((cwd) => {
        const workspace = workspaces.find((item) => item.cwd === cwd);
        return workspace ? [workspace] : [];
      })
    : workspaces;
  const moveWorkspace = (cwd: string, step: -1 | 1) => {
    const order = workspaces.map((workspace) => workspace.cwd);
    const from = order.indexOf(cwd);
    const to = from + step;
    if (from < 0 || to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorderWorkspaces(next);
  };

  const order = sidebarOrder([
    pinnedSessions,
    ...workspaces.map((ws) => ws.sessions),
    chatSessions,
  ]);
  // A chat sent a prompt rises to the top of its section, and a pinned one
  // moves to Pinned; each section lists a chat once, so one layout id suffices.
  const renderMovingRow = (session: SessionSummary) => (
    <SidebarMovingRow
      key={session.appSessionId}
      layoutId={`workspaces-${session.appSessionId}`}
      order={order}
      arriving={session.createdAt > shownAt}
    >
      {renderRow(session)}
    </SidebarMovingRow>
  );

  const renderSessionList = (
    sectionKey: string,
    sessions: SessionSummary[],
    earlier?: { count: number; onShow: () => void },
  ) => (
    <SidebarSessionList
      sessions={sessions}
      defaultVisibleCount={defaultVisibleCount}
      visibleCount={visibleCountFor(sectionKey)}
      activeAppSessionId={activeAppSessionId}
      renderRow={renderMovingRow}
      onShowMore={() => {
        showMore(sectionKey);
      }}
      onShowLess={() => {
        showLess(sectionKey);
      }}
      earlierSessionCount={earlier?.count}
      onShowEarlier={earlier?.onShow}
    />
  );

  if (
    isFiltered &&
    workspaces.length === 0 &&
    chatSessions.length === 0 &&
    pinnedSessions.length === 0
  ) {
    return <p className="px-3 py-2 text-caption text-muted">No tasks match this view.</p>;
  }

  return (
    <>
      {/* Pinned — every pinned chat across workspaces, hidden while empty */}
      {pinnedSessions.length > 0 &&
        (() => {
          const open = !collapsed.has('__pinned__');
          return (
            <div>
              <SidebarSectionHeading
                label="Pinned"
                open={open}
                count={pinnedSessions.length}
                onToggle={() => {
                  toggleCollapse('__pinned__');
                }}
              />
              <Expand open={open}>{renderSessionList('__pinned__', pinnedSessions)}</Expand>
            </div>
          );
        })()}

      {/* Workspaces — folder-scoped, where sessions run (main area) */}
      {(() => {
        // Filtered views hide sections with no matching rows.
        if (isFiltered && workspaces.length === 0) return null;
        const open = !collapsed.has('__workspaces__');
        return (
          <div>
            <SidebarSectionHeading
              label="Workspaces"
              open={open}
              count={workspaces.length}
              onToggle={() => {
                toggleCollapse('__workspaces__');
              }}
              action={
                <Tooltip label="Add workspace">
                  <button
                    type="button"
                    onClick={() => {
                      void onAddWorkspace();
                    }}
                    aria-label="Add workspace"
                    className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted transition-colors hover:text-primary"
                  >
                    <Plus className="size-icon-sm" />
                  </button>
                </Tooltip>
              }
            />

            <Expand open={open}>
              {workspaces.length === 0 ? (
                <Row
                  icon={<FolderOpen className="size-icon-md" />}
                  label="Open workspace"
                  onClick={() => {
                    void onAddWorkspace();
                  }}
                />
              ) : (
                <>
                  {canReorder && (
                    <span id={reorderHelpId} className="sr-only">
                      Drag the grip to reorder this workspace. Alt with Up or Down moves it.
                    </span>
                  )}
                  <Reorder.Group
                    as="div"
                    axis="y"
                    layoutScroll
                    values={orderedWorkspaces.map((workspace) => workspace.cwd)}
                    onReorder={previewReorder}
                    className="flex flex-col gap-2.5"
                  >
                    {orderedWorkspaces.map((ws) => {
                      const wsOpen = !collapsed.has(ws.cwd);
                      return (
                        <WorkspaceReorderItem
                          key={ws.cwd}
                          cwd={ws.cwd}
                          enabled={canReorder}
                          onCommit={commitReorder}
                        >
                          {(dragControls) => (
                            <SidebarWorkspaceRow
                              name={ws.name}
                              open={wsOpen}
                              dragControls={dragControls}
                              onMove={
                                dragControls
                                  ? (step) => {
                                      moveWorkspace(ws.cwd, step);
                                    }
                                  : undefined
                              }
                              reorderHelpId={dragControls ? reorderHelpId : undefined}
                              onToggle={() => {
                                toggleCollapse(ws.cwd);
                              }}
                              onNewChat={() => {
                                onNewChat(ws.cwd);
                              }}
                              onRemove={() => {
                                onRemoveWorkspace(ws.cwd);
                              }}
                            >
                              <Expand open={wsOpen}>
                                {renderSessionList(ws.cwd, ws.sessions, {
                                  count: ws.earlierSessionCount,
                                  onShow: () => {
                                    onShowEarlierSessions(ws.executionCwds);
                                  },
                                })}
                              </Expand>
                            </SidebarWorkspaceRow>
                          )}
                        </WorkspaceReorderItem>
                      );
                    })}
                  </Reorder.Group>
                </>
              )}
            </Expand>
          </div>
        );
      })()}

      {/* Chats — plain, folder-less conversations */}
      {(() => {
        if (isFiltered && chatSessions.length === 0) return null;
        const open = !collapsed.has('__chats__');
        return (
          <div>
            <SidebarSectionHeading
              label="Chats"
              open={open}
              count={chatSessions.length}
              onToggle={() => {
                toggleCollapse('__chats__');
              }}
            />
            <Expand open={open}>
              {chatSessions.length === 0 ? (
                <div className="mt-0.5 px-3 py-2 text-caption text-muted">No chats yet.</div>
              ) : (
                renderSessionList('__chats__', chatSessions)
              )}
            </Expand>
          </div>
        );
      })()}
    </>
  );
}
