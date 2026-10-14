import { useCallback, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Folder, FolderMinus, FolderOpen, Plus } from '@droidex/icons';
import { Menu } from './ui/Menu';

const EASE = [0.16, 1, 0.3, 1] as const;
const MENU_WIDTH = 200;

function WorkspaceFolderIcon({ open }: { open: boolean }) {
  const reduceMotion = useReducedMotion();
  const duration = reduceMotion ? 0 : 0.15;
  return (
    <span className="relative block size-icon-md shrink-0 text-muted transition-colors group-hover:text-secondary">
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
  );
}

// The workspace's right-click menu, opened at the pointer through a zero-size
// point anchor so the shared positioning hook keeps it inside the window.
function WorkspaceContextMenu({
  x,
  y,
  name,
  onRemove,
  onClose,
}: {
  x: number;
  y: number;
  name: string;
  onRemove: () => void;
  onClose: () => void;
}) {
  const pointRef = useRef<HTMLSpanElement>(null);

  return (
    <>
      <span
        ref={pointRef}
        aria-hidden="true"
        className="pointer-events-none fixed size-0"
        style={{ left: x, top: y }}
      />
      <Menu
        open
        onClose={onClose}
        anchorRef={pointRef}
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
    </>
  );
}

export function SidebarWorkspaceRow({
  name,
  open,
  onToggle,
  onNewChat,
  onRemove,
  children,
}: {
  name: string;
  open: boolean;
  onToggle: () => void;
  onNewChat: () => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => {
    setMenu(null);
  }, []);

  return (
    <div>
      <div className="group flex items-center gap-1 py-1.5 pl-3 pr-2.5">
        <button
          type="button"
          onClick={onToggle}
          onContextMenu={(event) => {
            event.preventDefault();
            setMenu({ x: event.clientX, y: event.clientY });
          }}
          aria-expanded={open}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-sm text-left"
        >
          <WorkspaceFolderIcon open={open} />
          <span title={name} className="min-w-0 flex-1 truncate text-body text-primary">
            {name}
          </span>
        </button>
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
      {menu ? (
        <WorkspaceContextMenu
          x={menu.x}
          y={menu.y}
          name={name}
          onRemove={onRemove}
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
