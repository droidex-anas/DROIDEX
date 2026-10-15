import type { ReactNode } from 'react';
import { ArrowLeft, type IconComponent } from '@droidex/icons';
import { Button } from '../ui/Button';
import { Tooltip } from '../ui/Tooltip';

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
    <Button
      variant="ghost"
      size="sm"
      icon={ArrowLeft}
      onClick={onClick}
      aria-label="Back to side chat"
    />
  );
}

export function SideChatHeaderButton({
  label,
  icon,
  disabled = false,
  pressed,
  onClick,
}: {
  label: string;
  icon: IconComponent;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} placement="bottom">
      <Button
        variant="ghost"
        size="sm"
        icon={icon}
        aria-label={label}
        aria-pressed={pressed}
        disabled={disabled}
        onClick={onClick}
      />
    </Tooltip>
  );
}
