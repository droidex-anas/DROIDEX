/** Spring integration for the effort slider, exactly as the reference tuned it. */

export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));

export const smoothstep = (a: number, b: number, n: number) => {
  const t = clamp((n - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface Spring {
  value: number;
  target: number;
  velocity: number;
}

export const spring = (value: number): Spring => ({ value, target: value, velocity: 0 });

export function integrate(s: Spring, dt: number, stiffness: number, damping: number): boolean {
  // Small substeps keep the spring stable after a slow browser frame.
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    s.velocity += ((s.target - s.value) * stiffness - s.velocity * damping) * h;
    s.value += s.velocity * h;
  }
  if (Math.abs(s.target - s.value) < 0.0001 && Math.abs(s.velocity) < 0.001) {
    s.value = s.target;
    s.velocity = 0;
  }
  return s.value !== s.target || s.velocity !== 0;
}
