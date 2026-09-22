import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowUp, Square } from 'lucide-react';
import { Spinner } from '@droidex/icons';

export function ComposerSendButton({
  starting,
  live,
  hasContent,
  disabled,
  title,
  enterSteers,
  hintOpen,
  parked = false,
  onHintOpenChange,
  onSend,
  onStop,
}: {
  starting: boolean;
  live: boolean;
  hasContent: boolean;
  disabled: boolean;
  title: string | undefined;
  enterSteers: boolean;
  hintOpen: boolean;
  // The action slot keeps this mounted while it is slid offstage (empty idle
  // draft shows the voice twin instead); parked removes it from focus.
  parked?: boolean;
  onHintOpenChange: (open: boolean) => void;
  onSend: () => void;
  onStop: () => void;
}) {
  const reducedMotion = useReducedMotion();
  // Parked (slid offstage for the voice twin) drops the button from focus and
  // the a11y tree while it stays mounted for the transform swap.
  const parkedProps: { tabIndex?: number; 'aria-hidden'?: boolean } = parked
    ? { tabIndex: -1, 'aria-hidden': true }
    : {};
  if (starting) {
    return (
      <button
        type="button"
        disabled
        title="Starting turn"
        aria-label="Starting turn"
        {...parkedProps}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg opacity-90"
      >
        <Spinner className="h-4 w-4 motion-safe:animate-spin-slow" />
      </button>
    );
  }
  if (live && !hasContent) {
    return (
      <button
        type="button"
        onClick={onStop}
        title="Working — click to stop"
        aria-label="Stop turn"
        {...parkedProps}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity hover:opacity-90"
      >
        <Square className="h-3.5 w-3.5" fill="currentColor" strokeWidth={0} />
      </button>
    );
  }
  const setHint = (open: boolean) => () => {
    onHintOpenChange(open);
  };
  return (
    // Keyboard users reach the send button by tab, never by pointer, so focus
    // opens the same hint that hover does.
    <div
      className="relative shrink-0"
      onMouseEnter={setHint(true)}
      onMouseLeave={setHint(false)}
      onFocus={setHint(true)}
      onBlur={setHint(false)}
    >
      <AnimatePresence>
        {live && hintOpen && (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
            transition={{ duration: reducedMotion ? 0 : 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="absolute bottom-full right-0 z-50 mb-2 flex flex-col gap-0.5 rounded-xl border border-droid-border bg-droid-elevated p-1.5 shadow-droid"
          >
            {[
              { label: enterSteers ? 'Steer' : 'Queue', keys: ['⏎'] },
              { label: enterSteers ? 'Queue' : 'Steer', keys: ['⌘', '⏎'] },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-[12px] text-droid-text"
              >
                <span>{row.label}</span>
                <span className="flex items-center gap-0.5 rounded-md bg-droid-bg/70 px-1.5 py-0.5 text-[11px] text-droid-text-secondary">
                  {row.keys.map((key) => (
                    <kbd key={key} className="font-sans leading-none">
                      {key}
                    </kbd>
                  ))}
                </span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        onClick={onSend}
        disabled={disabled || (!live && !hasContent)}
        title={title}
        aria-label={live ? (enterSteers ? 'Steer' : 'Queue prompt') : 'Send prompt'}
        {...parkedProps}
        className="flex h-8 w-8 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity enabled:hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <ArrowUp className="h-4 w-4" />
      </button>
    </div>
  );
}
