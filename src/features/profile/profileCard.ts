import { CREATURE_CELLS, pixelCreature } from '../../lib/pixelCreature';
import { activityCalendar, dateFromDayKey, HEAT_MIX_PERCENT, heatLevel } from './activityCalendar';
import { profileSeed } from './ProfileAvatar';
import type { PublicProfileSnapshot } from './profileShare';

// Renders the shareable profile card entirely on the client. The card always
// uses the dark DROIDEX theme so a shared image looks the same on every
// timeline, regardless of the viewer's or owner's app theme.
const CARD = { width: 1200, height: 630, scale: 2 } as const;
const PAD = 72;
const BACKGROUND = '#0b0b0c';
const INK = '#f2f2f2';
const SECONDARY = '#a3a3a3';
const MUTED = '#6f6f6f';
const ELEVATED = '#1c1c1e';
const CREAM = '#f2efe9';
const ORANGE = '#ff4d00';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const HEATMAP_WEEKS = 53;

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('en');

// The DX pixel mark in grid cells (see assets/brand): D then X.
const MARK_D = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
  [0, 1],
  [4, 1],
  [0, 2],
  [4, 2],
  [0, 3],
  [4, 3],
  [0, 4],
  [1, 4],
  [2, 4],
  [3, 4],
];
const MARK_X = [
  [6, 0],
  [10, 0],
  [7, 1],
  [9, 1],
  [8, 2],
  [7, 3],
  [9, 3],
  [6, 4],
  [10, 4],
];

function rgb(hex: string): [number, number, number] {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function mix(from: string, to: string, amount: number): string {
  const [ar, ag, ab] = rgb(from);
  const [br, bg, bb] = rgb(to);
  const channel = (a: number, b: number) => Math.round(a + (b - a) * amount);
  return `rgb(${String(channel(ar, br))},${String(channel(ag, bg))},${String(channel(ab, bb))})`;
}

function alpha(hex: string, opacity: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${String(r)},${String(g)},${String(b)},${String(opacity)})`;
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

function days(count: number): string {
  return `${String(count)} ${count === 1 ? 'day' : 'days'}`;
}

function drawBackdrop(ctx: CanvasRenderingContext2D, color: string) {
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, CARD.width, CARD.height);
  const glow = ctx.createRadialGradient(160, 120, 0, 160, 120, 760);
  glow.addColorStop(0, alpha(color, 0.3));
  glow.addColorStop(0.45, alpha(color, 0.08));
  glow.addColorStop(1, alpha(color, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD.width, CARD.height);
  ctx.fillStyle = 'rgba(255,255,255,0.045)';
  for (let x = 12; x < CARD.width; x += 24) {
    for (let y = 12; y < CARD.height; y += 24) ctx.fillRect(x, y, 2, 2);
  }
}

function drawMark(ctx: CanvasRenderingContext2D, x: number, y: number, cell: number) {
  ctx.fillStyle = CREAM;
  for (const [col, row] of MARK_D) ctx.fillRect(x + col * cell, y + row * cell, cell, cell);
  ctx.fillStyle = ORANGE;
  for (const [col, row] of MARK_X) ctx.fillRect(x + col * cell, y + row * cell, cell, cell);
}

function drawAvatar(
  ctx: CanvasRenderingContext2D,
  seed: string,
  x: number,
  y: number,
  size: number,
) {
  const { grid, color } = pixelCreature(seed);
  ctx.fillStyle = mix(ELEVATED, color, 0.18);
  ctx.beginPath();
  ctx.roundRect(x, y, size, size, size * 0.26);
  ctx.fill();
  const padding = size * 0.2;
  const cell = (size - padding * 2) / CREATURE_CELLS;
  ctx.fillStyle = color;
  grid.forEach((row, r) => {
    row.forEach((on, c) => {
      if (!on) return;
      ctx.beginPath();
      ctx.roundRect(
        x + padding + c * cell,
        y + padding + r * cell,
        cell + 0.5,
        cell + 0.5,
        cell * 0.12,
      );
      ctx.fill();
    });
  });
}

function drawChip(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  ctx.font = `600 20px ${FONT}`;
  const width = ctx.measureText(text).width + 32;
  ctx.fillStyle = alpha(color, 0.18);
  ctx.beginPath();
  ctx.roundRect(x, y, width, 36, 18);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(text, x + 16, y + 25);
}

function drawHeatmap(
  ctx: CanvasRenderingContext2D,
  snapshot: PublicProfileSnapshot,
  color: string,
) {
  const cells = activityCalendar(
    snapshot.days,
    dateFromDayKey(snapshot.generatedDay),
    HEATMAP_WEEKS,
  );
  const recordedDays = new Set(snapshot.days.map((day) => day.date));
  const peak = Math.max(1, ...cells.map((cell) => cell.tokens));
  const step = (CARD.width - PAD * 2 + 4) / HEATMAP_WEEKS;
  const size = step - 4;
  const top = 456;
  cells.forEach((cell, index) => {
    if (cell.future) return;
    let level = 0;
    if (snapshot.tokensReported) level = heatLevel(cell.tokens, peak);
    else if (recordedDays.has(cell.key)) level = 2;
    ctx.fillStyle = level === 0 ? ELEVATED : mix(ELEVATED, color, HEAT_MIX_PERCENT[level] / 100);
    ctx.beginPath();
    ctx.roundRect(PAD + Math.floor(index / 7) * step, top + (index % 7) * step, size, size, 3);
    ctx.fill();
  });

  ctx.font = `400 18px ${FONT}`;
  ctx.fillStyle = SECONDARY;
  ctx.fillText('Last 12 months', PAD, top - 16);
  const legendRight = CARD.width - PAD;
  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  if (snapshot.tokensReported) {
    ctx.fillText('More', legendRight, top - 16);
    const swatchesRight = legendRight - ctx.measureText('More').width - 10;
    for (let level = 4; level >= 0; level -= 1) {
      ctx.fillStyle = level === 0 ? ELEVATED : mix(ELEVATED, color, HEAT_MIX_PERCENT[level] / 100);
      ctx.beginPath();
      ctx.roundRect(swatchesRight - (5 - level) * 18, top - 30, 14, 14, 3);
      ctx.fill();
    }
    ctx.fillStyle = MUTED;
    ctx.fillText('Less', swatchesRight - 5 * 18 - 8, top - 16);
  } else {
    ctx.fillText('Token counts unavailable', legendRight, top - 16);
  }
  ctx.textAlign = 'left';
}

function drawProfileCard(snapshot: PublicProfileSnapshot): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CARD.width * CARD.scale;
  canvas.height = CARD.height * CARD.scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This browser cannot render a profile card.');
  ctx.scale(CARD.scale, CARD.scale);
  const seed = profileSeed(snapshot);
  const { color } = pixelCreature(seed);

  drawBackdrop(ctx, color);

  drawMark(ctx, PAD, 56, 5);
  ctx.fillStyle = INK;
  ctx.font = `600 20px ${FONT}`;
  ctx.fillText('DROIDEX', PAD + 55 + 14, 56 + 20);
  ctx.textAlign = 'right';
  ctx.fillStyle = MUTED;
  ctx.font = `400 18px ${FONT}`;
  ctx.fillText(
    dateFromDayKey(snapshot.generatedDay).toLocaleDateString('en', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    CARD.width - PAD,
    56 + 20,
  );
  ctx.textAlign = 'left';

  const avatarSize = 148;
  drawAvatar(ctx, seed, PAD, 124, avatarSize);
  const textX = PAD + avatarSize + 36;
  ctx.fillStyle = INK;
  ctx.font = `700 60px ${FONT}`;
  ctx.fillText(truncate(ctx, snapshot.displayName, CARD.width - PAD - textX), textX, 190);
  ctx.fillStyle = SECONDARY;
  ctx.font = `400 26px ${FONT}`;
  ctx.fillText(`@${snapshot.username}`, textX, 232);
  if (snapshot.currentStreak > 0)
    drawChip(ctx, `${days(snapshot.currentStreak)} streak`, textX, 248, color);

  const minimum = snapshot.tokensComplete ? '' : '≥';
  const tokenValue = snapshot.tokensReported
    ? `${minimum}${compact.format(snapshot.lifetimeTokens)}`
    : 'Unknown';
  const peakValue = snapshot.tokensReported
    ? `${minimum}${compact.format(snapshot.peakDayTokens)}`
    : 'Unknown';
  const stats: [string, string][] = [
    [
      tokenValue,
      snapshot.tokensReported && !snapshot.tokensComplete
        ? 'Measured tokens (minimum)'
        : 'Lifetime tokens',
    ],
    [integer.format(snapshot.sessions), 'DROIDEX sessions'],
    [peakValue, 'Peak day'],
    [days(snapshot.longestStreak), 'Longest streak'],
  ];
  const column = (CARD.width - PAD * 2) / stats.length;
  stats.forEach(([value, label], index) => {
    const x = PAD + index * column;
    ctx.fillStyle = INK;
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText(value, x, 362);
    ctx.fillStyle = SECONDARY;
    ctx.font = `400 18px ${FONT}`;
    ctx.fillText(label, x, 392);
  });

  drawHeatmap(ctx, snapshot, color);
  return canvas;
}

export async function profileCardBlob(snapshot: PublicProfileSnapshot): Promise<Blob> {
  const canvas = drawProfileCard(snapshot);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('This browser could not export the profile card.'));
    }, 'image/png');
  });
}

export async function downloadProfileCard(snapshot: PublicProfileSnapshot): Promise<void> {
  const blob = await profileCardBlob(snapshot);
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = `droidex-${snapshot.username}.png`;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
