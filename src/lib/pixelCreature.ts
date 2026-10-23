// A deterministic pixel creature in the spirit of the DROIDEX silkscreen brand:
// a 5×5 mirrored grid hashed from a stable seed and tinted from a fixed
// palette. Subagents and user profiles share it so identities look alike.

const PALETTE = [
  '#a07cff',
  '#ff5d2e',
  '#7c9cff',
  '#ff7a6b',
  '#5b8def',
  '#ffa94d',
  '#9b8cff',
  '#ff6fae',
  '#4fd1c5',
  '#c084fc',
];

export const CREATURE_CELLS = 5;

export interface PixelCreature {
  grid: boolean[][];
  color: string;
}

function hashSeed(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function creatureFromHash(h: number): PixelCreature & { lit: number } {
  const grid: boolean[][] = [];
  let lit = 0;
  for (let r = 0; r < CREATURE_CELLS; r += 1) {
    const left: boolean[] = [];
    for (let c = 0; c < 3; c += 1) {
      const on = ((h >> (r * 3 + c)) & 1) === 1;
      left.push(on);
      if (on) lit += 1;
    }
    // Mirror the three hashed columns so the grid reads as a creature.
    grid.push([left[0], left[1], left[2], left[1], left[0]]);
  }
  return { grid, color: PALETTE[h % PALETTE.length], lit };
}

// Re-hash sparse seeds so every creature reads as a shape, not noise.
export function pixelCreature(seed: string): PixelCreature {
  const first = creatureFromHash(hashSeed(seed));
  if (first.lit >= 4) return first;
  const second = creatureFromHash(hashSeed(`${seed}#2`));
  if (second.lit >= 4) return second;
  const third = creatureFromHash(hashSeed(`${seed}#3`));
  return [first, second, third].reduce((a, b) => (b.lit > a.lit ? b : a));
}
