import { useSidebarPagination } from '../hooks/useSidebarPagination';
import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Plus, FolderOpen } from 'lucide-react';
import { SIDEBAR_VISIBLE_SESSION_LIMIT, type WorkspaceSection } from '../lib/workspaces';
import type { SessionSummary } from '../types/bridge';
import { SidebarSectionHeading } from './SidebarSectionHeading';
import { SidebarWorkspaceRow } from './SidebarWorkspaceRow';
import { SidebarSessionList } from './SidebarSessionList';

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
  onShowEarlierSessions,
  limit = SIDEBAR_VISIBLE_SESSION_LIMIT,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { defaultVisibleCount, visibleCountFor, showMore, showLess } = useSidebarPagination(limit);
  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
      renderRow={renderRow}
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
    return <p className="px-3 py-2 text-[12px] text-droid-text-muted">No tasks match this view.</p>;
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
                <button
                  type="button"
                  onClick={() => {
                    void onAddWorkspace();
                  }}
                  title="Add workspace"
                  aria-label="Add workspace"
                  className="shrink-0 cursor-pointer rounded-md p-0.5 text-droid-text-muted transition-colors hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/40"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              }
            />

            <Expand open={open}>
              <div className="space-y-2.5">
                {workspaces.map((ws) => {
                  const wsOpen = !collapsed.has(ws.cwd);
                  return (
                    <SidebarWorkspaceRow
                      key={ws.cwd}
                      name={ws.name}
                      open={wsOpen}
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
                  );
                })}

                {workspaces.length === 0 && (
                  <button
                    onClick={() => {
                      void onAddWorkspace();
                    }}
                    className="flex w-full cursor-pointer items-center gap-2.5 py-1.5 pl-3 pr-2 text-left text-droid-text-muted transition-colors hover:text-droid-text"
                  >
                    <FolderOpen className="w-4 h-4 shrink-0" />
                    <span className="text-[13px]">Open workspace</span>
                  </button>
                )}
              </div>
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
                <div className="mt-0.5 px-3 py-2 text-[12px] text-droid-text-muted">
                  No chats yet.
                </div>
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
