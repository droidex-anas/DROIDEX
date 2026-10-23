import { motion, useReducedMotion, type TargetAndTransition, type Transition } from 'framer-motion';
import { ArrowRight, X } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { Line, Solid } from './RemoteArt';
import {
  LAUNCH_BROWSER,
  LAUNCH_BROWSER_LINES,
  LAUNCH_HALO,
  LAUNCH_HEIGHT,
  LAUNCH_LAPTOP_BASE,
  LAUNCH_LAPTOP_LID,
  LAUNCH_LAPTOP_LINES,
  LAUNCH_LINK,
  LAUNCH_LOCK,
  LAUNCH_LOCK_LINES,
  LAUNCH_MIRROR_RULES,
  LAUNCH_WIDTH,
} from './remoteLaunchArtPaths';

const EASE = [0.16, 1, 0.3, 1] as const;
const LOOP_SECONDS = 6;

// One loop, as shares of LOOP_SECONDS: a packet leaves the laptop, the lock
// settles as it passes, the packet reaches the browser and its screen fills in
// to mirror the laptop, then everything rests and resets.
const AT_LOCK = 0.26;
const LOCKED = 0.34;
const ARRIVED = 0.6;
const RESET = 0.92;

type Keyframes = { opacity: number[] } | { y: number[] };

// The frame each part holds once the loop has played: the one before the reset.
function settledFrame(frames: Keyframes): TargetAndTransition {
  if ('opacity' in frames) return { opacity: frames.opacity[frames.opacity.length - 2] };
  return { y: frames.y[frames.y.length - 2] };
}

// Under reduced motion every part shows its settled frame and stays still.
function useLoop() {
  const reduceMotion = useReducedMotion();
  return (frames: Keyframes, times: number[]) => {
    if (reduceMotion) return { initial: false as const, animate: settledFrame(frames) };
    const transition: Transition = {
      duration: LOOP_SECONDS,
      times,
      repeat: Infinity,
      ease: 'easeInOut',
    };
    return { initial: false as const, animate: frames, transition };
  };
}

function LaunchArt() {
  const loop = useLoop();
  const reduceMotion = useReducedMotion();
  return (
    <svg
      viewBox={`0 0 ${String(LAUNCH_WIDTH)} ${String(LAUNCH_HEIGHT)}`}
      aria-hidden="true"
      fill="none"
      strokeWidth={0.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="block h-auto w-full overflow-visible"
    >
      {LAUNCH_HALO.map((d) => (
        <path key={d} d={d} className="translate-y-1 fill-text/15 blur dark:fill-bg/90" />
      ))}
      <Solid paths={LAUNCH_LAPTOP_BASE} />
      <Line d={LAUNCH_LAPTOP_LINES.keyboard} tone="faint" />
      <Line d={LAUNCH_LAPTOP_LINES.trackpad} tone="faint" />
      <Solid paths={LAUNCH_LAPTOP_LID} />
      <Line d={LAUNCH_LAPTOP_LINES.screen} tone="mid" />
      <Line d={LAUNCH_LAPTOP_LINES.rules} tone="mid" />

      <Solid paths={LAUNCH_BROWSER} />
      <Line d={LAUNCH_BROWSER_LINES.screen} tone="mid" />
      <Line d={LAUNCH_BROWSER_LINES.bar} tone="lo" />
      <Line d={LAUNCH_BROWSER_LINES.dots} tone="lo" />
      <Line d={LAUNCH_BROWSER_LINES.address} tone="lo" />
      {LAUNCH_MIRROR_RULES.map((d, index) => {
        const shown = ARRIVED + 0.03 + index * 0.035;
        return (
          <motion.g
            key={d}
            {...loop({ opacity: [0, 0, 1, 1, 0] }, [0, shown - 0.02, shown + 0.02, RESET, 1])}
          >
            <Line d={d} tone="mid" />
          </motion.g>
        );
      })}

      <g strokeDasharray="0.01 3" strokeWidth={1}>
        <Line d={LAUNCH_LINK} tone="lo" />
      </g>
      <motion.g {...loop({ opacity: [0, 0, 1, 1, 0] }, [0, ARRIVED, ARRIVED + 0.06, RESET, 1])}>
        <Line d={LAUNCH_LINK} tone="success" />
      </motion.g>

      <Solid paths={LAUNCH_LOCK} />
      <Line d={LAUNCH_LOCK_LINES.top} tone="faint" />
      <motion.g {...loop({ y: [-2.5, -2.5, 0, 0, -2.5] }, [0, AT_LOCK, LOCKED, RESET, 1])}>
        <Line d={LAUNCH_LOCK_LINES.shackle} tone="hi" />
      </motion.g>
      <Line d={LAUNCH_LOCK_LINES.keyhole} tone="mid" />
      <motion.g {...loop({ opacity: [0, 0, 1, 1, 0] }, [0, AT_LOCK, LOCKED, RESET, 1])}>
        <Line d={LAUNCH_LOCK_LINES.keyhole} tone="success" />
      </motion.g>

      {!reduceMotion && (
        <motion.path
          d={LAUNCH_LINK}
          className="stroke-success"
          strokeWidth={1.6}
          initial={{ pathLength: 0.08, pathOffset: 0, opacity: 0 }}
          animate={{
            pathOffset: [0, 0, 0.44, 0.44, 0.92, 0.92],
            opacity: [0, 1, 1, 1, 1, 0],
          }}
          transition={{
            duration: LOOP_SECONDS,
            times: [0, 0.04, AT_LOCK, LOCKED, ARRIVED, ARRIVED + 0.04],
            repeat: Infinity,
            ease: 'easeInOut',
          }}
        />
      )}
    </svg>
  );
}

// Announces Remote above the sidebar's Settings row, in the welcome card's
// slot. Sidebar decides when it shows; the card only renders and reports.
export function RemoteLaunchCard({
  onClaim,
  onDismiss,
}: {
  onClaim: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98, height: 0, marginBottom: 0 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="mb-2 overflow-hidden"
    >
      <section
        aria-labelledby="remote-launch-title"
        className="relative overflow-hidden rounded-xl bg-raised shadow-lg"
      >
        <div className="bg-elevated/60 px-5 pb-2 pt-5">
          <LaunchArt />
        </div>
        <div className="px-3.5 pb-3 pt-2.5">
          <h2 id="remote-launch-title" className="text-body-strong text-primary">
            DROIDEX, from any browser
          </h2>
          <p className="mt-1 text-body text-muted">
            Open this laptop’s chats from your phone or another computer, end-to-end encrypted.
          </p>
          <Button variant="primary" size="sm" onClick={onClaim} className="mt-2.5">
            <span className="flex items-center gap-1.5">
              Claim your username
              <ArrowRight className="size-icon-sm" aria-hidden="true" />
            </span>
          </Button>
        </div>
        {/* Button sets its own `relative`, so the wrapper does the positioning. */}
        <div className="absolute right-1.5 top-1.5">
          <Button variant="ghost" size="sm" icon={X} aria-label="Dismiss" onClick={onDismiss} />
        </div>
      </section>
    </motion.div>
  );
}
