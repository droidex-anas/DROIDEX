import type { ReactNode } from 'react';
import { X } from 'lucide-react';

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
      className="no-drag fixed right-4 top-4 flex h-9 w-9 items-center justify-center rounded-xl bg-droid-raised/90 text-droid-text-secondary shadow-droid-sm backdrop-blur-md transition-colors duration-150 hover:bg-droid-active hover:text-droid-text focus-visible:bg-droid-active focus-visible:text-droid-text focus-visible:outline-none"
    >
      <X className="h-4 w-4" />
    </button>
  );
}

export function ViewerToolbar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      role="toolbar"
      aria-label={label}
      onClick={stopBackdropClose}
      onDoubleClick={stopBackdropClose}
      className="no-drag fixed bottom-6 left-1/2 flex h-11 -translate-x-1/2 items-center gap-0.5 rounded-2xl bg-droid-raised/90 px-1.5 shadow-droid backdrop-blur-md"
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
      className={`flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-2 text-[12.5px] font-medium transition-colors duration-150 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-35 ${
        primary
          ? 'bg-droid-accent text-droid-bg hover:opacity-90 focus-visible:opacity-90'
          : 'text-droid-text-secondary hover:bg-droid-active hover:text-droid-text focus-visible:bg-droid-active focus-visible:text-droid-text'
      }`}
    >
      {children}
    </button>
  );
}

export function ViewerToolbarDivider() {
  return <div aria-hidden className="mx-1 h-5 w-px bg-droid-border" />;
}
