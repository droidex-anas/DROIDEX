import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { ArrowUp } from '@droidex/icons';

function fitToContent(el: HTMLTextAreaElement, maxHeight: number) {
  el.style.height = 'auto';
  el.style.height = `${String(Math.min(el.scrollHeight, maxHeight))}px`;
}

/* The small composer the side chat and the design prompt box share: a
   textarea that grows with its text and a round send button. Enter sends,
   Shift+Enter starts a new line, and keys an IME is using stay the IME's.
   With a leading control (the side chat's harness chip) the text sits above a
   row of controls; without one it folds to a single line beside send. */

export function CompactComposer({
  value,
  onChange,
  onSend,
  canSend,
  placeholder,
  label,
  sendLabel,
  leading,
  status,
  action,
  autoFocus,
  textareaRef,
  onEscape,
  maxHeight = 160,
  className = 'shadow-droid-sm',
}: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  canSend: boolean;
  placeholder: string;
  label: string;
  sendLabel: string;
  leading?: ReactNode;
  // Shown before the action, such as why nothing can be sent right now.
  status?: ReactNode;
  // Takes the send button's place, such as a stop button while a reply runs.
  action?: ReactNode;
  autoFocus?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onEscape?: () => void;
  /** How tall the text grows before it scrolls. */
  maxHeight?: number;
  // The box's elevation, which differs between a docked and a floating box.
  className?: string;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = textareaRef ?? ownRef;

  // Measured before paint, so a new line never shows a frame at the old height.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) fitToContent(el, maxHeight);
  }, [ref, value, maxHeight]);

  // A box mounted while its container is still opening first measures a
  // narrow, over-wrapped text; refit once the width settles.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fitToContent(el, maxHeight);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [ref, maxHeight]);

  const textarea = (
    <textarea
      ref={ref}
      autoFocus={autoFocus}
      rows={leading ? 2 : 1}
      value={value}
      placeholder={placeholder}
      aria-label={label}
      onChange={(event) => {
        onChange(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key === 'Process') return;
        if (event.key === 'Escape' && onEscape) {
          event.preventDefault();
          event.stopPropagation();
          onEscape();
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          if (canSend) onSend();
        }
      }}
      className={`block w-full resize-none bg-transparent text-[13px] leading-5 text-droid-text placeholder:text-droid-text-muted focus:outline-none ${
        leading ? 'px-3.5 pt-3' : 'min-w-0 flex-1 py-1'
      }`}
    />
  );

  const trailing = (
    <>
      {status}
      {action ?? (
        <button
          type="button"
          onClick={onSend}
          disabled={!canSend}
          aria-label={sendLabel}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
      )}
    </>
  );

  return leading ? (
    <div className={`rounded-[16px] bg-droid-raised ${className}`}>
      {textarea}
      <div className="flex items-center gap-2 px-2 pb-2">
        <div className="min-w-0 flex-1">{leading}</div>
        {trailing}
      </div>
    </div>
  ) : (
    <div
      className={`flex items-end gap-2 rounded-[16px] bg-droid-raised py-1.5 pl-3.5 pr-1.5 ${className}`}
    >
      {textarea}
      {trailing}
    </div>
  );
}
