import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUp, Square } from '@droidex/icons';

const MAX_HEIGHT_PX = 160;

function fitToContent(el: HTMLTextAreaElement) {
  el.style.height = 'auto';
  el.style.height = `${String(Math.min(el.scrollHeight, MAX_HEIGHT_PX))}px`;
}

/* The side chat's own small composer: a question, send, and stop while the
   side chat answers. A side question is short,
   so there are no attachments, skills, or modes here; the main composer has them. */

export function SideChatComposer({
  initialText = '',
  placeholder,
  live,
  blockedReason,
  leading,
  onSend,
  onStop,
}: {
  initialText?: string;
  placeholder: string;
  live: boolean;
  // Why nothing can be sent right now, shown in place of the send hint.
  blockedReason?: string;
  // The harness chip for a new side chat; follow-ups have none and fold to one line.
  leading?: ReactNode;
  // Returns whether the text was taken, so a refused send keeps the draft.
  onSend: (text: string) => boolean;
  onStop?: () => void;
}) {
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const canSend = !live && !blockedReason && text.trim().length > 0;

  useEffect(() => {
    const el = textareaRef.current;
    if (el) fitToContent(el);
  }, [text]);

  // Docking mounts the composer while the utility pane is still opening, so the
  // first measure sees a narrow, over-wrapped box; refit once the width settles.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    let lastWidth = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === lastWidth) return;
      lastWidth = el.clientWidth;
      fitToContent(el);
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  const send = () => {
    if (!canSend) return;
    if (onSend(text)) setText('');
  };

  const textarea = (
    <textarea
      ref={textareaRef}
      autoFocus
      rows={leading ? 2 : 1}
      value={text}
      placeholder={placeholder}
      aria-label="Side chat message"
      onChange={(event) => {
        setText(event.target.value);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
        event.preventDefault();
        send();
      }}
      className={`block w-full resize-none bg-transparent text-[13px] leading-5 text-droid-text placeholder:text-droid-text-muted focus:outline-none ${
        leading ? 'px-3.5 pt-3' : 'min-w-0 flex-1 py-1'
      }`}
    />
  );

  const action =
    live && onStop ? (
      <button
        type="button"
        onClick={onStop}
        aria-label="Stop side chat"
        title="Stop"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity hover:opacity-90"
      >
        <Square className="h-3 w-3" fill="currentColor" strokeWidth={0} />
      </button>
    ) : (
      <button
        type="button"
        onClick={send}
        disabled={!canSend}
        aria-label="Send side chat message"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
    );

  const blocked = blockedReason ? (
    <span className="min-w-0 truncate text-[11px] text-droid-text-muted">{blockedReason}</span>
  ) : null;

  return (
    <div className="shrink-0 px-3 pb-3 pt-1">
      {leading ? (
        <div className="rounded-[16px] bg-droid-raised shadow-droid-sm">
          {textarea}
          <div className="flex items-center gap-2 px-2 pb-2">
            <div className="min-w-0 flex-1">{leading}</div>
            {blocked}
            {action}
          </div>
        </div>
      ) : (
        // A follow-up has no harness to pick, so it folds to one line beside send.
        <div className="flex items-end gap-2 rounded-[16px] bg-droid-raised py-1.5 pl-3.5 pr-1.5 shadow-droid-sm">
          {textarea}
          {blocked}
          {action}
        </div>
      )}
    </div>
  );
}
