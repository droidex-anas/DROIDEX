/** @type {import('tailwindcss').Config} */
// Wrap each themed CSS variable so Tailwind's `/opacity` modifiers resolve to a
// valid color. Without this, `border-divider/40` emits an invalid value and
// border-color falls back to currentColor (producing bright/white borders).
const v = (name) => `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

// Control and icon sizes from docs/design-system/tokens.json, for h-, w-,
// size-, min-h- and min-w- (`size-control-sm`, `h-icon-md`).
const sizes = {
  'control-sm': '28px',
  'control-md': '32px',
  'control-lg': '36px',
  'icon-sm': '14px',
  'icon-md': '16px',
  'icon-lg': '20px',
};

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    // Plain CSS for the effort slider's shadow root, not Tailwind markup.
    '!./src/components/effortSlider/effortSliderStyles.ts',
  ],
  // applyTheme marks <html data-theme="dark|light"> from the applied canvas.
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    // The design-system radius scale replaces Tailwind's; there is no bare
    // `rounded`. Off-scale radii stay arbitrary values (`rounded-[2px]`).
    borderRadius: {
      none: '0px',
      xs: '4px',
      sm: '6px',
      md: '8px',
      lg: '12px',
      xl: '16px',
      '2xl': '24px',
      full: '9999px',
    },
    extend: {
      // Names follow docs/design-system (README "Naming"). Text colours read
      // `text-primary`/`text-secondary`/`text-muted`; `text` is the same colour
      // for fills and rings (`bg-text`, `ring-text`).
      colors: {
        bg: v('--bg'),
        surface: v('--surface'),
        elevated: v('--elevated'),
        field: v('--field'),
        active: v('--active'),
        raised: v('--raised'),
        sidebar: v('--sidebar'),
        divider: v('--divider'),
        'divider-strong': v('--divider-strong'),
        text: v('--text'),
        primary: v('--text'),
        secondary: v('--text-secondary'),
        muted: v('--text-muted'),
        accent: v('--accent'),
        skill: v('--skill'),
        'visualize-mark': v('--visualize-mark'),
        ultra: v('--ultra'),
        success: v('--success'),
        'success-soft': v('--success-soft'),
        warning: v('--warning'),
        'warning-soft': v('--warning-soft'),
        danger: v('--danger'),
        'danger-soft': v('--danger-soft'),
        'focus-ring': v('--focus-ring'),
        update: v('--update'),
        'update-hover': v('--update-hover'),
        'on-update': v('--on-update'),
        'brand-ink': v('--brand-ink'),
        'brand-paper': v('--brand-paper'),
        'brand-orange': v('--brand-orange'),
      },
      // Floating surfaces take their cast and their faint edge ring from the
      // theme (see deriveThemeTokens). A fixed `shadow-black/50` reads as a
      // grey smudge on a paper canvas. These replace Tailwind's `sm`/`lg`.
      boxShadow: {
        sm: 'var(--shadow-sm)',
        lg: 'var(--shadow-lg)',
        'focus-update': 'var(--shadow-focus-update)',
      },
      // The design-system type scale (docs/design-system/README.md "Type"):
      // one class sets size, line height, tracking and weight. #root's zoom
      // scales these with the Appearance UI size like every other px value.
      // Families stay separate: `wordmark` pairs with `font-pixel`, `code` and
      // `code-sm` with `font-mono`, and `overline` with `uppercase`.
      fontSize: {
        wordmark: ['32px', { lineHeight: '32px', letterSpacing: '-0.04em', fontWeight: '400' }],
        display: ['24px', { lineHeight: '30px', letterSpacing: '-0.48px', fontWeight: '600' }],
        title: ['22px', { lineHeight: '28px', letterSpacing: '-0.44px', fontWeight: '600' }],
        heading: ['18px', { lineHeight: '22px', letterSpacing: '-0.27px', fontWeight: '600' }],
        subheading: ['16px', { lineHeight: '20px', letterSpacing: '-0.16px', fontWeight: '600' }],
        prose: ['14px', { lineHeight: '22px', letterSpacing: '-0.15px', fontWeight: '400' }],
        'body-lg': ['14px', { lineHeight: '20px', letterSpacing: '-0.15px', fontWeight: '400' }],
        body: ['13px', { lineHeight: '18px', letterSpacing: '-0.08px', fontWeight: '400' }],
        'body-strong': [
          '13px',
          { lineHeight: '18px', letterSpacing: '-0.08px', fontWeight: '500' },
        ],
        label: ['12px', { lineHeight: '16px', letterSpacing: '0px', fontWeight: '500' }],
        caption: ['11px', { lineHeight: '16px', letterSpacing: '0.06px', fontWeight: '400' }],
        overline: ['10px', { lineHeight: '12px', letterSpacing: '0.8px', fontWeight: '500' }],
        // Follows the Appearance code size (12px by default, 18px leading).
        code: [
          'var(--code-font-size)',
          { lineHeight: '1.5', letterSpacing: '0px', fontWeight: '400' },
        ],
        'code-sm': ['11px', { lineHeight: '16px', letterSpacing: '0px', fontWeight: '400' }],
      },
      height: sizes,
      // The fixed shell columns (rules.md "Sizes"): `w-sidebar` and the
      // floating context panel the chat insets its content for, plus the
      // transcript's media and browser cards.
      width: { ...sizes, sidebar: '280px', 'context-panel': '312px', 'chat-card': '360px' },
      size: sizes,
      minHeight: sizes,
      minWidth: sizes,
      // Interaction values from feel.md and the README's states: the 0.97
      // button press, the 1.5px ring (focus, invalid fields) and the smooth-out
      // curve for anything that moves or opens.
      scale: { 97: '0.97' },
      ringWidth: { 1.5: '1.5px' },
      transitionTimingFunction: { 'smooth-out': 'var(--ease-smooth-out)' },
      // Floating layers stack popovers < dialogs < toasts < tooltips.
      zIndex: {
        popover: '1000',
        dialog: '1100',
        toast: '1200',
        tooltip: '1300',
      },
      fontFamily: {
        // The Appearance font (applyTheme's --ui-font-family), which defaults
        // to the system face so macOS switches SF Pro Text/Display optically.
        sans: ['var(--ui-font-family)'],
        pixel: ['Silkscreen', '"JetBrains Mono"', 'monospace'],
        // Native mono stack first: the JetBrains Mono webfont is fetched from
        // Google Fonts, so offline/packaged sessions would otherwise fall all
        // the way to Chromium's default `monospace` (Courier), which is what
        // made diff counts and gutters look off. ui-monospace resolves to
        // SF Mono on macOS, matching what dev tools render.
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          '"SF Mono"',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          '"JetBrains Mono"',
          'monospace',
        ],
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'pulse-glow': 'pulseGlow 2s ease-in-out infinite',
        'spin-slow': 'spin 1.8s linear infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(232, 168, 56, 0.3)' },
          '50%': { boxShadow: '0 0 0 4px rgba(232, 168, 56, 0)' },
        },
      },
    },
  },
  plugins: [],
};
