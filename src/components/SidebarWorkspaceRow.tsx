import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Folder, FolderMinus, FolderOpen, Plus } from '@droidex/icons';
import { pushEscapeLayer } from './ui/escapeStack';

const EASE = [0.16, 1, 0.3, 1] as const;
const MENU_WIDTH = 200;
const MENU_MARGIN = 8;
const MENU_CHROME_PX = 18;
const MENU_ROW_PX = 30;

const itemClass =
  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body text-primary outline-none transition-colors hover:bg-elevated focus-visible:bg-elevated dark:hover:bg-active dark:focus-visible:bg-active';

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

export function WorkspaceContextMenuPanel({
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
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pop = pushEscapeLayer(onClose);
    window.addEventListener('blur', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      pop();
      window.removeEventListener('blur', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, []);

  const viewportWidth = typeof window === 'undefined' ? undefined : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? undefined : window.innerHeight;
  const estimatedMenuHeight = MENU_CHROME_PX + MENU_ROW_PX;
  const left =
    viewportWidth === undefined
      ? Math.max(MENU_MARGIN, x)
      : Math.min(Math.max(MENU_MARGIN, x), viewportWidth - MENU_WIDTH - MENU_MARGIN);
  const top =
    viewportHeight === undefined
      ? Math.max(MENU_MARGIN, y)
      : Math.min(Math.max(MENU_MARGIN, y), viewportHeight - estimatedMenuHeight - MENU_MARGIN);

  return (
    <motion.div
      ref={panelRef}
      role="menu"
      aria-label={`${name} workspace`}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12, ease: EASE }}
      onContextMenu={(event) => {
        event.preventDefault();
      }}
      style={{ position: 'fixed', left, top, width: MENU_WIDTH }}
      className="z-popover rounded-lg bg-raised p-1.5 shadow-lg"
    >
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          onRemove();
          onClose();
        }}
        className={itemClass}
      >
        <FolderMinus className="size-icon-md shrink-0 text-muted" />
        Remove workspace
      </button>
    </motion.div>
  );
}

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
  return createPortal(
    <>
      <div
        className="fixed inset-0 z-popover"
        onMouseDown={onClose}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose();
        }}
      />
      <WorkspaceContextMenuPanel x={x} y={y} name={name} onRemove={onRemove} onClose={onClose} />
    </>,
    document.body,
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
