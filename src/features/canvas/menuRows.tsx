// The rows the board's canvas picker and the chat column's attached-chats menu
// are both built from, so the two popovers read as one menu style.

import { Check } from '@droidex/icons';

/** Wide enough for a canvas or chat name; the width the pane's tool menu uses. */
export const MENU_WIDTH_PX = 248;

export function MenuHeading({ children }: { children: string }) {
  return (
    <div className="truncate px-2.5 pb-1 pt-2 text-caption font-medium text-muted first:pt-1">
      {children}
    </div>
  );
}

export function MenuNote({ children, role }: { children: string; role?: 'status' | 'alert' }) {
  return (
    <p
      {...(role ? { role } : {})}
      className={`px-2.5 pb-1 text-caption ${role === 'alert' ? 'text-danger' : 'text-muted'}`}
    >
      {children}
    </p>
  );
}

export function MenuRow({
  label,
  hint,
  checked = false,
  disabled = false,
  onRun,
}: {
  label: string;
  /** A keyboard shortcut, shown muted at the row's end. */
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onRun}
      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 text-left transition-colors hover:bg-accent/10 focus-visible:bg-accent/10 focus-visible:outline-none disabled:cursor-default disabled:opacity-60 disabled:hover:bg-transparent"
    >
      <span className="min-w-0 flex-1 truncate text-label font-normal text-primary">{label}</span>
      {hint && <span className="shrink-0 text-caption text-muted">{hint}</span>}
      {checked && <Check aria-label="Current" className="h-3.5 w-3.5 shrink-0 text-accent" />}
    </button>
  );
}
