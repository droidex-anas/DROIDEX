import { MotionConfig, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { Lock } from '@droidex/icons';
import { BrandMark } from '../../src/components/BrandMark';
import { RemoteArt, type RemoteArtScene } from '../../src/features/remote/RemoteArt';
import { JourneySteps } from '../../src/features/remote/RemoteJourney';

export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

const JOURNEY = ['Username', 'Code', 'Approval'] as const;

/** Where a browser is on its way in; past the last step means connected. */
export type GateStep = 0 | 1 | 2 | 3;

/**
 * The full-screen frame for every Remote screen shown before, or instead of,
 * the app. The picture and the steps stay put while the words change.
 */
export function GateLayout({
  handle,
  scene,
  step,
  children,
}: {
  handle?: string;
  scene: RemoteArtScene;
  /** Left out on screens that sit outside the journey, such as offline. */
  step?: GateStep;
  children: ReactNode;
}) {
  return (
    <MotionConfig reducedMotion="user">
      <motion.main
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
        className="remote-gate fixed inset-0 z-tooltip flex flex-col overflow-y-auto bg-bg text-primary"
      >
        <header className="remote-gate-top flex shrink-0 items-center justify-between gap-4 px-6 pb-2">
          <p className="flex items-center gap-2">
            <BrandMark size={13} className="text-primary" />
            <span className="text-label text-muted">Remote</span>
          </p>
          {handle && (
            <p className="truncate text-label text-muted" title="Your laptop">
              @{handle}
            </p>
          )}
        </header>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-8 px-6 py-10">
          <RemoteArt scene={scene} className="mx-auto max-w-64" />
          {step !== undefined && (
            <JourneySteps label="Connecting this browser" steps={JOURNEY} current={step} />
          )}
          {children}
        </div>
        <footer className="remote-gate-bottom flex shrink-0 items-center justify-center gap-1.5 px-6 text-caption text-muted">
          <Lock className="size-icon-sm" aria-hidden="true" />
          End-to-end encrypted to your laptop
        </footer>
      </motion.main>
    </MotionConfig>
  );
}

/**
 * One gate screen: a headline, one line, then the single thing to do. Keyed
 * by its caller, so a change of screen cross-fades.
 */
export function GateScreen({
  title,
  line,
  children,
}: {
  title: string;
  line: ReactNode;
  children?: ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-col gap-2">
        <h1 className="text-balance text-title text-primary">{title}</h1>
        <p className="text-pretty text-body-lg text-secondary">{line}</p>
      </div>
      {children}
    </motion.section>
  );
}
