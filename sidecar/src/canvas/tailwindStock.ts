// The stock Tailwind 3 values designs compile against: the value each key of
// a utility's scale sets, and the class each keyword property's value has.
// tailwindStyles.test.ts compiles every class written from them.

export type Scale = Readonly<Record<string, string>>;

const SPACING_STEPS = [
  0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48,
  52, 56, 60, 64, 72, 80, 96,
];
export const SPACING: Scale = {
  '0': '0px',
  px: '1px',
  ...Object.fromEntries(SPACING_STEPS.map((step) => [String(step), `${String(step / 4)}rem`])),
};
export const MIN_SIZE: Scale = { ...SPACING, full: '100%' };
export const SIZE: Scale = { ...MIN_SIZE, auto: 'auto', fit: 'fit-content' };
export const MAX_SIZE: Scale = { ...MIN_SIZE, none: 'none' };
export const RADIUS: Scale = {
  none: '0px',
  sm: '0.125rem',
  '': '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
  '2xl': '1rem',
  '3xl': '1.5rem',
  full: '9999px',
};
export const FONT_WEIGHT: Scale = {
  thin: '100',
  extralight: '200',
  light: '300',
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
  black: '900',
};
export const LINE_HEIGHT: Scale = {
  '3': '.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '7': '1.75rem',
  '8': '2rem',
  '9': '2.25rem',
  '10': '2.5rem',
  none: '1',
  tight: '1.25',
  snug: '1.375',
  normal: '1.5',
  relaxed: '1.625',
  loose: '2',
};
export const TRACKING: Scale = {
  tighter: '-0.05em',
  tight: '-0.025em',
  normal: '0em',
  wide: '0.025em',
  wider: '0.05em',
  widest: '0.1em',
};
export const OPACITY: Scale = Object.fromEntries(
  Array.from({ length: 21 }, (_, index) => [String(index * 5), String(index / 20)]),
);
/** Each stock font size with the line height it sets alongside. */
export const FONT_SIZE_LINE_HEIGHT: Scale = {
  xs: '1rem',
  sm: '1.25rem',
  base: '1.5rem',
  lg: '1.75rem',
  xl: '1.75rem',
  '2xl': '2rem',
  '3xl': '2.25rem',
  '4xl': '2.5rem',
  '5xl': '1',
  '6xl': '1',
  '7xl': '1',
  '8xl': '1',
  '9xl': '1',
};
export const FONT_FAMILIES = new Set(['sans', 'serif', 'mono']);
export const SHADOWS = new Set(['', 'sm', 'md', 'lg', 'xl', '2xl', 'inner', 'none']);
export const BORDER_WIDTH: Scale = { '': '1px', '0': '0px', '2': '2px', '4': '4px', '8': '8px' };

/** Keyword properties, by the CSS value each stock class sets. */
export const KEYWORD_CLASSES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  display: {
    block: 'block',
    'inline-block': 'inline-block',
    inline: 'inline',
    flex: 'flex',
    'inline-flex': 'inline-flex',
    grid: 'grid',
    none: 'hidden',
  },
  flexWrap: { nowrap: 'flex-nowrap', wrap: 'flex-wrap', 'wrap-reverse': 'flex-wrap-reverse' },
  flexGrow: { '1': 'grow', '0': 'grow-0' },
  alignSelf: {
    auto: 'self-auto',
    'flex-start': 'self-start',
    center: 'self-center',
    'flex-end': 'self-end',
    stretch: 'self-stretch',
    baseline: 'self-baseline',
  },
  borderStyle: {
    solid: 'border-solid',
    dashed: 'border-dashed',
    dotted: 'border-dotted',
    double: 'border-double',
    none: 'border-none',
  },
  textAlign: {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
    justify: 'text-justify',
    start: 'text-start',
    end: 'text-end',
  },
  textTransform: {
    none: 'normal-case',
    uppercase: 'uppercase',
    lowercase: 'lowercase',
    capitalize: 'capitalize',
  },
  overflow: {
    visible: 'overflow-visible',
    hidden: 'overflow-hidden',
    clip: 'overflow-clip',
    scroll: 'overflow-scroll',
    auto: 'overflow-auto',
  },
  flexDirection: {
    row: 'flex-row',
    'row-reverse': 'flex-row-reverse',
    column: 'flex-col',
    'column-reverse': 'flex-col-reverse',
  },
  alignItems: {
    'flex-start': 'items-start',
    'flex-end': 'items-end',
    center: 'items-center',
    baseline: 'items-baseline',
    stretch: 'items-stretch',
  },
  justifyContent: {
    normal: 'justify-normal',
    'flex-start': 'justify-start',
    'flex-end': 'justify-end',
    center: 'justify-center',
    'space-between': 'justify-between',
    'space-around': 'justify-around',
    'space-evenly': 'justify-evenly',
    stretch: 'justify-stretch',
  },
};
