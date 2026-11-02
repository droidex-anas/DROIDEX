import type { AuthoredPreset } from '../authored.js';

export const FEEL = `Basalt is a dark-first system for the tools developers live in: deploy consoles, log viewers, terminals, API dashboards and settings for infrastructure. The chrome is five steps of near-black basalt in Instrument Sans, so the output, the status and the one lava accent are the loudest things on screen. JetBrains Mono appears only where the content is code: hashes, keys, logs, snippets.

- Dark is the reference. Light mode keeps the same steps and hues for daylight and screenshots; design in dark first and check light.
- Dense and quiet: 13px body, 30px controls, 2px between rows.
- Tone separates layers; a 1px light edge inside the shadow keeps a floating card crisp on black.
- Lava marks the next action, focus and a live cursor. Status speaks in green, amber and red, always with a word.
`;

export const INTERACTION = `- Hover lays --ds-lift over a row or control; press lays --ds-press. Rows never move or grow.
- The current row takes active and keeps it while focus moves elsewhere. Mark it with aria-current.
- The command palette opens on ⌘K with the input focused; the highlighted result runs on Enter and shows ↵.
- A destructive or traffic-moving action asks for the resource's name and says what will change, in words, before the button.
- A running state pulses nothing: its dot gains a soft ring and its time keeps counting.
- Motion is 110ms for hover and toggles, 70ms to leave and 180ms for a palette or dialog to arrive. Reduced motion turns all of it off.
`;

export const LAYOUT = `The app frame is a 240px sidebar on surface, a 44px header on raised with the breadcrumb and the page's search, and a canvas with 24px gutters up to 1280px.

- List and detail: a 400px list on the left, the detail card filling the rest, with the log or code at the bottom of the detail.
- Rows are 34px or two-line: the subject in label, the hash and branch in caption below, the state and time on the right.
- Logs sit on surface in a three-column grid: timestamp in muted, level in its tone, message in secondary.
- Settings pages stack a header with one primary, a table card, and a usage snippet.
`;

export const COPY = `Sentence case, short and literal. Name the resource the way the CLI does (ledger-api, a91c3e0, deps/pg). Buttons say the operation: Deploy main, Roll back, Create key, Revoke. Times are relative under a day ("40s ago", "2h ago"), dates after. Durations as 1m 51s. Errors quote the tool's message and add the next step. Never call a failure "oops" or a success "magic".
`;

export const CHECKLIST = `Before you ship a screen: designed in dark and checked in light; code and identifiers in mono, nothing else; every status has a word; destructive actions confirm by name; ⌘K and Escape work; one lava action per view.
`;

export const SECTION_NOTES: AuthoredPreset['sectionNotes'] = {
  colors: [
    {
      kind: 'note',
      label: 'colour.md',
      body: `Basalt neutrals run canvas (logs, the page) → surface (sidebar, code blocks, window bodies) → raised (header, cards, menus) → elevated (fields, keycaps, secondary buttons) → active (the current row). Lava is the only hue in chrome: the primary action, focus, the live cursor. Status: positive for ready, warning for building or degraded, danger for failed. The Syntax colours are for code only, on surface or canvas, where each passes 4.5:1.
`,
    },
  ],
  typography: [
    {
      kind: 'note',
      label: 'type.md',
      body: `Instrument Sans sets all chrome: 13 for body and buttons, 12 for labels, 11 for captions, 10 for overlines and keycaps. Headings are 600 at 18–22; title (30) and display (40) are for empty states and marketing pages. JetBrains Mono is the code font only (code, 12): hashes, keys, paths, log lines and snippets, never labels or numbers in a table. Add ds-tabular to counters and durations that update.
`,
    },
  ],
  spacing: [
    {
      kind: 'note',
      label: 'spacing.md',
      body: `A 4px grid, kept tight. 2 between rows, 6–12 inside rows and controls, 16 between a list and its detail, 24 as the page gutter.
`,
    },
  ],
  radius: [
    {
      kind: 'note',
      label: 'radius.md',
      body: `4 for badges and keycaps, 6 for controls and rows, 8 for code blocks, 10 for cards, 14 for windows, palettes and dialogs. Pill only for status dots.
`,
    },
  ],
  shadows: [
    {
      kind: 'note',
      label: 'shadows.md',
      body: `On black a shadow alone disappears, so md and lg carry a 1px light edge inside their blur. sm lifts a sticky header; md sits under cards on the canvas; lg is for the palette, menus and dialogs.
`,
    },
  ],
  motion: [
    {
      kind: 'note',
      label: 'motion.md',
      body: `Fast (70) to leave and press, the default (110) for hover and toggles, slow (180) for a palette, menu or dialog to arrive. Logs append without animation; a running state keeps counting instead of spinning.
`,
    },
  ],
  size: [
    {
      kind: 'note',
      label: 'size.md',
      body: `Controls are 26 in toolbars and tabs, 30 by default and 34 for rows and a lone primary. Icons are 14 beside captions, 16 by default and 18 in the sidebar.
`,
    },
  ],
};

export const USAGE: AuthoredPreset['usage'] = {
  'button.md':
    'In Basalt buttons are compact (30px) with a 16px icon and a literal verb. A traffic-moving action asks for confirmation in a dialog first.\n',
  'input.md':
    'Fields fill with elevated. Confirmation fields ask the user to type the resource name and explain a mismatch in the error.\n',
  'card.md':
    'A card holds one list, one detail or one table. Card pads 24px; override it with !p-2 for a list and !p-5 for a detail.\n',
  'badge.md':
    'Basalt badges are 10px, 4px corners, on accent-soft: environment names, scopes, "Live". Status uses ds-status dots, not badges.\n',
  'tabs.md': 'Tabs switch an environment or a log stream; keep them short and sentence case.\n',
  'dialog.md':
    'Dialogs confirm a consequential change or show a secret once; the primary names the change ("Roll back").\n',
};
