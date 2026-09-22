import { clamp, smoothstep } from './effortSliderSpring';

/**
 * The Ultracode pixel field: a five-row shimmer of lavender squares that a
 * soft reveal carries right to left when the top level engages, and that keeps
 * breathing while it is held. Verbatim from the reference painting code.
 */
export interface UltraFieldFrame {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  opacity: number;
  startedAt: number | null;
  reducedMotion: boolean;
}

export function paintUltraField(frame: UltraFieldFrame): void {
  const { ctx, width, height, time, opacity, startedAt, reducedMotion } = frame;
  ctx.clearRect(0, 0, width, height);
  if (opacity < 0.002) return;
  const age = Math.max(0, (time - (startedAt ?? time) - 220) / 1000);
  const front = reducedMotion ? 0.035 : 1 - 0.97 * (1 - Math.exp(-age / 1.02));
  const t = reducedMotion ? 1.2 : time / 1000;
  const pitch = height / 5;
  const size = pitch * 0.64;
  const columns = Math.ceil(width / pitch);
  for (let column = 0; column < columns; column++) {
    const x = column * pitch + (pitch - size) / 2;
    const nx = (x + size / 2) / width;
    const reveal = smoothstep(front - 0.07, front + 0.19, nx);
    const envelope = smoothstep(0.015, 0.68, nx);
    if (reveal * envelope < 0.005) continue;
    for (let row = 0; row < 5; row++) {
      const seed = Math.sin(column * 127.1 + row * 311.7) * 43758.5453;
      const noise = seed - Math.floor(seed);
      const wave =
        0.64 +
        0.17 * Math.sin(column * 0.46 + row * 0.83 + t * 2.1) +
        0.12 * Math.sin(column * 0.89 - row * 1.24 - t * 1.4);
      const alpha = clamp(
        opacity * reveal * envelope * (0.24 + wave * 0.21) * (0.76 + noise * 0.34),
      );
      const lavender = Math.sin(column * 0.3 + row * 0.8 + t);
      ctx.fillStyle = `rgba(${String(170 + Math.round(lavender * 9))},${String(151 + Math.round(lavender * 6))},${String(221 + Math.round(lavender * 9))},${String(alpha)})`;
      ctx.beginPath();
      ctx.roundRect(x, row * pitch + (pitch - size) / 2, size, size, pitch * 0.12);
      ctx.fill();
    }
  }
}
