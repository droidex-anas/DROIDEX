import { MotionConfig, motion } from 'framer-motion';
import { Check, LockKeyhole } from 'lucide-react';
import type { ReactNode } from 'react';
import { BrandMark } from '../../src/components/BrandMark';

export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

// Gate screens are touch-first, so their actions are taller than the app's 32px buttons.
export const largeButton = '!h-11 !rounded-xl !px-5 !text-[14px]';

export const fieldClass =
  'h-11 min-w-0 flex-1 rounded-xl bg-droid-field px-3.5 text-[16px] text-droid-text transition-colors duration-150 placeholder:text-droid-text-muted focus:outline-none focus-visible:bg-droid-active focus-visible:ring-2 focus-visible:ring-droid-accent/15 sm:text-[14px]';

/** The full-screen frame for every Remote screen shown before, or instead of, the app. */
export function GateLayout({ handle, children }: { handle?: string; children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
        className="fixed inset-0 z-[1300] flex flex-col overflow-y-auto bg-droid-bg text-droid-text"
      >
        <header className="flex shrink-0 items-center justify-between gap-4 px-6 pb-2 pt-[max(22px,env(safe-area-inset-top))]">
          <p className="flex items-baseline gap-2">
            <BrandMark size={13} className="text-droid-text" />
            <span className="text-[12px] text-droid-text-muted">Remote</span>
          </p>
          {handle && (
            <p className="truncate text-[12px] text-droid-text-muted" title="Your laptop">
              @{handle}
            </p>
          )}
        </header>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-6 py-10">
          {children}
        </div>
        <footer className="flex shrink-0 items-center justify-center gap-1.5 px-6 pb-[max(22px,env(safe-area-inset-bottom))] text-[11px] text-droid-text-muted">
          <LockKeyhole size={11} aria-hidden />
          End-to-end encrypted to your laptop
        </footer>
      </motion.main>
    </MotionConfig>
  );
}

/** One gate screen. Screens are keyed by their caller, so a change of screen cross-fades. */
export function GateScreen({
  icon,
  title,
  progress,
  children,
}: {
  icon?: ReactNode;
  title: string;
  progress?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
    >
      {progress}
      {icon && (
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-droid-elevated text-droid-text-secondary">
          {icon}
        </div>
      )}
      <h1 className={`${icon ? 'mt-6' : ''} text-[24px] font-semibold tracking-[-0.02em]`}>
        {title}
      </h1>
      {children && (
        <div className="mt-2 space-y-5 text-[14px] leading-6 text-droid-text-secondary">
          {children}
        </div>
      )}
    </motion.section>
  );
}

const JOURNEY = ['Unlock', 'Approve', 'Open'] as const;

/** Where a new browser is in its first connection: unlock, laptop approval, then the app. */
export function JourneySteps({ current }: { current: (typeof JOURNEY)[number] }) {
  const currentIndex = JOURNEY.indexOf(current);
  return (
    <ol aria-label="Connecting this browser" className="mb-8 flex items-center gap-2 text-[11px]">
      {JOURNEY.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden className="h-px w-5 bg-droid-border" />}
            <span
              aria-current={active ? 'step' : undefined}
              className={`flex items-center gap-1.5 ${active ? 'font-medium text-droid-text' : 'text-droid-text-muted'}`}
            >
              <span
                aria-hidden
                className={`grid h-4 w-4 place-items-center rounded-full text-[9px] tabular-nums transition-colors duration-200 ${
                  active ? 'bg-droid-text text-droid-bg' : 'bg-droid-elevated'
                }`}
              >
                {done ? <Check size={9} strokeWidth={3} /> : index + 1}
              </span>
              {step}
              {done && <span className="sr-only"> (done)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
