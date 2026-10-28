import { useCallback, useRef, useState, type ReactNode } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Folder, FolderMinus, FolderOpen, Plus } from '@droidex/icons';
import { Menu } from './ui/Menu';
import type { AnchorPoint } from './ui/usePopoverPosition';

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
  const rowButtonRef = useRef<HTMLButtonElement>(null);
  const [menuPoint, setMenuPoint] = useState<AnchorPoint | null>(null);
  const closeMenu = useCallback(() => {
    setMenuPoint(null);
  }, []);

  return (
    <div>
      <div className="group flex items-center gap-1 py-1.5 pl-3 pr-2.5">
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
