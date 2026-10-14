import type { ReactNode } from 'react';
import { X } from '@droidex/icons';

/* Floating controls shared by the full-window viewers. They float on the
   backdrop instead of sitting in a title bar, so nothing collides with the
   window's traffic lights, and they punch a no-drag hole so the title-bar drag
   region underneath cannot swallow their clicks. */

const stopBackdropClose = (event: { stopPropagation: () => void }) => {
  event.stopPropagation();
};

export function ViewerCloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      aria-label="Close"
      title="Close (Esc)"
      className="no-drag fixed right-4 top-4 flex h-9 w-9 items-center justify-center rounded-lg bg-raised/90 text-secondary shadow-sm backdrop-blur-md transition-colors duration-150 hover:bg-active hover:text-primary focus-visible:bg-active focus-visible:text-primary focus-visible:outline-none"
    >
      <X className="size-icon-md" />
    </button>
  );
}

export function ViewerToolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="group"
      aria-label={label}
      onClick={stopBackdropClose}
      onDoubleClick={stopBackdropClose}
      className="no-drag fixed bottom-6 left-1/2 flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-xl bg-raised/90 px-1.5 shadow-lg backdrop-blur-md"
    >
      {children}
    </div>
  );
}

export function ViewerToolbarButton({
  label,
  onClick,
  disabled = false,
  primary = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={`flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-md px-2 text-label transition-colors duration-150 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40 ${
        primary
          ? 'bg-accent text-bg hover:opacity-90 focus-visible:opacity-90'
          : 'text-secondary hover:bg-active hover:text-primary focus-visible:bg-active focus-visible:text-primary'
      }`}
    >
      {children}
    </button>
  );
}

export function ViewerToolbarDivider() {
  return <div aria-hidden className="mx-1 h-5 w-px bg-divider" />;
}
