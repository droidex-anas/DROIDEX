import { cn } from '../../components/ui/cn';
import {
  ART_HEIGHT,
  ART_WIDTH,
  HALO,
  LAPTOP_BASE,
  LAPTOP_LID,
  LAPTOP_LINES,
  LINK,
  LOCK,
  LOCK_LINES,
  PHONE,
  PHONE_LINES,
  type SolidPaths,
} from './remoteArtPaths';

/** One picture per moment of the Remote journey, on both the laptop and the browser. */
export type RemoteArtScene = 'intro' | 'handle' | 'key' | 'waiting' | 'live' | 'denied' | 'offline';

type Tone = 'strong' | 'hi' | 'mid' | 'lo' | 'faint' | 'success' | 'danger';
type LinkStyle = 'dotted' | 'travelling' | 'live' | 'broken' | 'refused';

const TONE: Record<Tone, string> = {
  strong: 'stroke-text',
  hi: 'stroke-secondary',
  mid: 'stroke-muted',
  lo: 'stroke-muted/60',
  faint: 'stroke-muted/30',
  success: 'stroke-success',
  danger: 'stroke-danger',
};

// Side faces by how they turn from the light, darkest first. Light themes
// recess toward `elevated`, dark ones toward the canvas.
const SHADE = [
  'fill-elevated dark:fill-bg',
  'fill-elevated/70 dark:fill-bg/60',
  'fill-elevated/40 dark:fill-bg/25',
  'fill-elevated/20 dark:fill-elevated/40',
];

interface SceneLook {
  screen: Tone;
  card: Tone;
  field: Tone;
  cells: Tone;
  lock: Tone;
  link: LinkStyle;
}

const SCENES: Record<RemoteArtScene, SceneLook> = {
  intro: { screen: 'lo', card: 'faint', field: 'lo', cells: 'faint', lock: 'hi', link: 'dotted' },
  handle: {
    screen: 'lo',
    card: 'faint',
    field: 'strong',
    cells: 'faint',
    lock: 'hi',
    link: 'dotted',
  },
  key: {
    screen: 'lo',
    card: 'faint',
    field: 'lo',
    cells: 'strong',
    lock: 'strong',
    link: 'dotted',
  },
  waiting: {
    screen: 'lo',
    card: 'strong',
    field: 'lo',
    cells: 'lo',
    lock: 'hi',
    link: 'travelling',
  },
  live: { screen: 'mid', card: 'faint', field: 'lo', cells: 'lo', lock: 'success', link: 'live' },
  denied: {
    screen: 'lo',
    card: 'faint',
    field: 'lo',
    cells: 'faint',
    lock: 'danger',
    link: 'refused',
  },
  offline: {
    screen: 'faint',
    card: 'faint',
    field: 'faint',
    cells: 'faint',
    lock: 'mid',
    link: 'broken',
  },
};

export function Line({ d, tone, className }: { d: string; tone: Tone; className?: string }) {
  return (
    <path
      d={d}
      vectorEffect="non-scaling-stroke"
      className={cn('transition-colors duration-300 ease-smooth-out', TONE[tone], className)}
    />
  );
}

export function Solid({ paths, edge = 'hi' }: { paths: SolidPaths; edge?: Tone }) {
  return (
    <g>
      <path d={paths.fill} className="fill-surface" />
      {paths.shades.map((d, index) =>
        d ? <path key={index} d={d} className={SHADE[index]} /> : null,
      )}
      <path d={paths.top} className="fill-raised" />
      {paths.crease && <Line d={paths.crease} tone="faint" />}
      <Line d={paths.outline} tone={edge} />
    </g>
  );
}

function Link({ style }: { style: LinkStyle }) {
  if (style === 'broken' || style === 'refused') {
    const tone = style === 'refused' ? 'danger' : 'faint';
    const [x, y] = LINK.joint;
    return (
      <>
        <g strokeDasharray="0.01 3.5" strokeWidth={1}>
          <Line d={LINK.toLock} tone={tone} />
          <Line d={LINK.fromLock} tone={tone} />
        </g>
        {style === 'refused' && (
          <Line d={`M${String(x - 2.5)} ${String(y - 9.5)}l5 5m0 -5l-5 5`} tone="danger" />
        )}
      </>
    );
  }
  if (style === 'dotted') {
    return (
      <g strokeDasharray="0.01 3.5" strokeWidth={1}>
        <Line d={LINK.whole} tone="mid" />
      </g>
    );
  }
  return (
    <Line d={LINK.whole} tone={style === 'live' ? 'success' : 'mid'} className="remote-link-flow" />
  );
}

// Decorative: every screen that shows it states the same thing in words.
export function RemoteArt({ scene, className }: { scene: RemoteArtScene; className?: string }) {
  const look = SCENES[scene];
  return (
    <svg
      viewBox={`0 0 ${String(ART_WIDTH)} ${String(ART_HEIGHT)}`}
      aria-hidden="true"
      fill="none"
      strokeWidth={0.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('block h-auto w-full overflow-visible', className)}
    >
      {HALO.map((d) => (
        <path key={d} d={d} className="translate-y-1 fill-text/15 blur dark:fill-bg/90" />
      ))}
      <Solid paths={LAPTOP_BASE} />
      <Line d={LAPTOP_LINES.keyboard} tone="faint" />
      <Line d={LAPTOP_LINES.trackpad} tone="faint" />
      <Solid paths={LAPTOP_LID} />
      <Line d={LAPTOP_LINES.screen} tone="mid" />
      <Line d={LAPTOP_LINES.rules} tone={look.screen} />
      <Line d={LAPTOP_LINES.card} tone={look.card} />
      <Line d={LAPTOP_LINES.cardRule} tone={look.card === 'strong' ? 'mid' : 'faint'} />
      <Line d={LAPTOP_LINES.cardButton} tone={look.card} />
      <Solid paths={LOCK} edge={look.lock} />
      <Line d={LOCK_LINES.top} tone="faint" />
      <Line d={LOCK_LINES.keyhole} tone={look.lock} />
      <Line d={LOCK_LINES.shackle} tone={look.lock} />
      <Solid paths={PHONE} />
      <Line d={PHONE_LINES.screen} tone="mid" />
      <Line d={PHONE_LINES.field} tone={look.field} />
      <Line d={PHONE_LINES.cells} tone={look.cells} />
      <Line d={PHONE_LINES.rules} tone="lo" />
      <Line
        d={PHONE_LINES.button}
        tone={look.field === 'strong' || look.cells === 'strong' ? 'hi' : 'lo'}
      />
      <Link style={look.link} />
    </svg>
  );
}
