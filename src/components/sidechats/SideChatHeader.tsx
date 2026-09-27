import type { ReactNode } from 'react';
import { ArrowLeft } from '@droidex/icons';
import { HoverTooltip } from '../HoverTooltip';

// Marks the header a floating side-chat window is dragged by.
export const SIDE_CHAT_DRAG_HANDLE = 'data-side-chat-drag-handle';

/* The row at the top of every side-chat view: what is shown, then its actions,
   then the placement's own controls. */
export function SideChatHeader({
  controls,
  children,
}: {
  controls: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      {...{ [SIDE_CHAT_DRAG_HANDLE]: '' }}
      className="flex shrink-0 items-center gap-1.5 px-3 py-2.5"
    >
      {children}
      {controls}
    </div>
  );
}

export function SideChatBackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to side chats"
      className="shrink-0 rounded-md p-1 text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
    </button>
  );
}

export function SideChatHeaderButton({
  label,
  disabled = false,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <HoverTooltip label={label} placement="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-droid-text-muted transition-colors enabled:hover:bg-droid-elevated/60 enabled:hover:text-droid-text disabled:opacity-40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
      >
        {children}
      </button>
    </HoverTooltip>
  );
}
