/** @type {import('tailwindcss').Config} */
// Wrap each themed CSS variable so Tailwind's `/opacity` modifiers resolve to a
// valid color. Without this, `border-divider/40` emits an invalid value and
// border-color falls back to currentColor (producing bright/white borders).
const v = (name) => `color-mix(in srgb, var(${name}) calc(<alpha-value> * 100%), transparent)`;

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    // Plain CSS for the effort slider's shadow root, not Tailwind markup.
    '!./src/components/effortSlider/effortSliderStyles.ts',
  ],
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
        warning: v('--warning'),
        danger: v('--danger'),
        update: v('--update'),
        'update-hover': v('--update-hover'),
      },
      // Floating surfaces take their cast from the theme (see applyTheme):
      // near-black and deep on dark, soft with a contact shadow on light. A
      // fixed `shadow-black/50` reads as a grey smudge on a paper canvas.
      // These replace Tailwind's default `sm`/`lg` shadows.
      boxShadow: {
        sm: 'var(--shadow-sm)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: ['"SF Pro Display"', 'Inter', 'system-ui', 'sans-serif'],
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
