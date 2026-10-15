// 32px action buttons shared by Profile and Remote. One primary per surface.
const base =
  'inline-flex h-8 select-none items-center justify-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/40 disabled:pointer-events-none disabled:opacity-40';

export const primaryButton = `${base} bg-droid-text text-droid-bg hover:bg-droid-text-secondary`;
export const secondaryButton = `${base} bg-droid-elevated text-droid-text hover:bg-droid-active`;
export const ghostButton = `${base} text-droid-text-secondary hover:bg-droid-elevated hover:text-droid-text`;
