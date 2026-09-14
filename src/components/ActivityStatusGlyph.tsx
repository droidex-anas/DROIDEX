import { ACTIVITY_LABELS, type SessionActivityStatus } from '../lib/sidebarActivity';

// The inbox marks each chat with the kind of state it is in, the way a
// ticket queue does: a dashed ring for nothing pending, a half ring for a
// turn that needs the user, a clock for a wait on their decision, a check
// once it is settled. One 14px stroke family, tinted by urgency.
const TONE: Record<SessionActivityStatus, string> = {
  working: 'text-droid-text',
  approval: 'text-droid-orange',
  input: 'text-droid-orange',
  plan: 'text-droid-orange',
  failed: 'text-droid-red',
  interrupted: 'text-droid-orange',
  reply: 'text-droid-accent',
  review: 'text-droid-accent',
  ship: 'text-droid-orange',
  ready: 'text-droid-text-muted',
  settled: 'text-droid-green',
};

type Shape = 'open' | 'active' | 'half' | 'clock' | 'failed' | 'paused' | 'done';

const SHAPE: Record<SessionActivityStatus, Shape> = {
  working: 'active',
  approval: 'clock',
  input: 'clock',
  plan: 'clock',
  failed: 'failed',
  interrupted: 'paused',
  reply: 'half',
  review: 'half',
  ship: 'half',
  ready: 'open',
  settled: 'done',
};

function ShapePath({ shape }: { shape: Shape }) {
  switch (shape) {
    case 'open':
      return <circle cx="8" cy="8" r="6" strokeDasharray="2.6 2.4" />;
    case 'active':
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="2" fill="currentColor" stroke="none" />
        </>
      );
    case 'half':
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none" />
        </>
      );
    case 'clock':
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 4.5V8l2.5 1.5" />
        </>
      );
    case 'failed':
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M6 6l4 4M10 6l-4 4" />
        </>
      );
    case 'paused':
      return (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M6.5 5.5v5M9.5 5.5v5" />
        </>
      );
    case 'done':
      return (
        <>
          <circle cx="8" cy="8" r="6" fill="currentColor" stroke="none" />
          <path d="M5.5 8.2l1.8 1.8L10.7 6.5" stroke="var(--droid-bg)" />
        </>
      );
  }
}

export function ActivityStatusGlyph({
  status,
  className = '',
}: {
  status: SessionActivityStatus;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-label={ACTIVITY_LABELS[status]}
      className={`shrink-0 ${TONE[status]} ${className}`}
    >
      <ShapePath shape={SHAPE[status]} />
    </svg>
  );
}

// The action a hovered mark offers: settle an open chat, reopen a settled one.
export function ActivityToggleGlyph({ settled }: { settled: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={14}
      height={14}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      {settled ? (
        <path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2M3.5 3v2.2h2.2" />
      ) : (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M5.5 8.2l1.8 1.8L10.7 6.5" />
        </>
      )}
    </svg>
  );
}
