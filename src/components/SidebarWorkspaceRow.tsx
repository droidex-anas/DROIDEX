import { useCallback, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion, type DragControls } from 'framer-motion';
import { Folder, FolderMinus, FolderOpen, GripVertical, Plus } from '@droidex/icons';
import { Menu } from './ui/Menu';
import type { AnchorPoint } from './ui/usePopoverPosition';

const EASE = [0.16, 1, 0.3, 1] as const;
const MENU_WIDTH = 200;

function WorkspaceFolderIcon({ open, reorderable }: { open: boolean; reorderable: boolean }) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.15;
  return (
    <span
      className={`block size-icon-md shrink-0 transition-opacity duration-quick ${
        reorderable ? 'group-hover:opacity-0 group-focus-within:opacity-0' : ''
      }`}
    >
      <span className="relative block size-icon-md text-muted transition-colors group-hover:text-secondary">
        <motion.span
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: open ? 0 : 1 }}
          transition={{ duration, ease: EASE }}
        >
          <Folder className="size-icon-md" />
        </motion.span>
        <motion.span
          className="absolute inset-0 flex items-center justify-center"
          initial={false}
          animate={{ opacity: open ? 1 : 0 }}
          transition={{ duration, ease: EASE }}
        >
          <FolderOpen className="size-icon-md" />
        </motion.span>
      </span>
    </span>
  );
}

export function SidebarWorkspaceRow({
  name,
  open,
  onToggle,
  onNewChat,
  onRemove,
  dragControls,
  onMove,
  reorderHelpId,
  children,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onRemove: () => void;
  dragControls?: DragControls;
  onMove?: (step: -1 | 1) => void;
  reorderHelpId?: string;
  children: ReactNode;
}) {
  const rowButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPoint, setMenuPoint] = useState<AnchorPoint | null>(null);
  const closeMenu = useCallback(() => {
    setMenuPoint(null);
  }, []);
  const reorderable = dragControls !== undefined && onMove !== undefined;

  return (
    <div>
      <div className="group relative flex items-center gap-1 py-1.5 pl-3 pr-2.5">
        <button
          ref={rowButtonRef}
          type="button"
          onClick={onToggle}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenuPoint({ x: event.clientX, y: event.clientY });
          }}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-sm text-left"
        >
          <WorkspaceFolderIcon open={open} reorderable={reorderable} />
          <span title={name} className="min-w-0 flex-1 truncate text-body text-primary">
            {name}
          </span>
        </button>
        {reorderable && (
          <button
            type="button"
            aria-label={`Move ${name} workspace`}
            aria-describedby={reorderHelpId}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            title="Drag to reorder"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              dragControls.start(event);
            }}
            onClick={(event) => {
              event.preventDefault();
            }}
            onKeyDown={(event) => {
              if (!event.altKey) return;
              let step: -1 | 1 | null = null;
              if (event.key === 'ArrowUp') step = -1;
              else if (event.key === 'ArrowDown') step = 1;
              if (step === null) return;
              event.preventDefault();
              event.stopPropagation();
              onMove(step);
            }}
            className="pointer-events-none absolute left-1.5 top-1/2 z-10 flex size-7 touch-none -translate-y-1/2 cursor-grab items-center justify-center rounded-sm text-primary opacity-0 transition-opacity duration-quick active:cursor-grabbing group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100"
          >
            <GripVertical className="size-icon-md" />
          </button>
        )}
        <button
          type="button"
          onClick={onNewChat}
          title="New chat here"
          aria-label={`New chat in ${name}`}
          className="shrink-0 cursor-pointer rounded-sm p-0.5 text-muted/0 transition-colors focus-visible:text-primary group-hover:text-muted hover:text-primary"
        >
          <Plus className="size-icon-sm" />
        </button>
      </div>
      {children}
      {menuPoint ? (
        <Menu
          open
          onClose={closeMenu}
          anchorRef={rowButtonRef}
          anchorPoint={menuPoint}
          label={`${name} workspace`}
          width={MENU_WIDTH}
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          <Menu.Item icon={FolderMinus} onSelect={onRemove}>
            Remove workspace
          </Menu.Item>
        </Menu>
      ) : null}
    </div>
  );
}
