import type { AuthoredPreset } from '../authored.js';

export const FEEL = `Gridline is a system for operational software people keep open all day: billing consoles, admin panels, analytics and internal tools. It makes a dense screen calm. Manrope's open shapes and tabular figures stay legible at 13px, a cool slate canvas holds white working surfaces, and one cobalt accent marks the next action, the selected row and focus.

- Dense, not crowded: 32px rows, 12px cell padding, 13px body.
- Numbers lead. Figures are tabular and right-aligned; units and periods sit beside them in muted.
- Structure comes from tone: canvas, then raised panels, then elevated fields. Tables stripe with surface instead of rules.
- Every colour is a state, a series or the action. Chrome stays slate.
`;

export const INTERACTION = `- Hover lays --ds-lift over a row or control; press lays --ds-press. Nothing scales or moves.
- A selected row takes accent-soft; a selected tab takes active.
- Focus is the 3px ring at 55% focus, for the keyboard only.
- Disabled controls drop to muted text on elevated and say why in a hint.
- Loading keeps the layout: skeleton rows hold the table's height, and figures never change width because they are tabular.
- Motion is 120ms on the standard ease for hover and toggles, 80ms to leave, 200ms for a panel or dialog to arrive.
`;

export const LAYOUT = `The app frame is a 232px sidebar on surface and a canvas with 24px gutters, up to 1200px of content.

- Page header: the heading (24) on the left, actions on the right, primary last.
- KPI cards come in rows of three or four: the overline label, the figure at title size, the change in positive or danger below.
- Tables: 32px rows, overline headers in muted, numeric columns right-aligned, the row's action at the far right.
- Forms: labels above, 8px between label and field, 16px between fields; dialogs are 520px.
`;

export const COPY = `Sentence case everywhere. Labels are nouns ("Invoices", "Seats"); buttons are verbs ("Export CSV", "Send reminder"). Money takes its symbol and two decimals in tables, none in headlines ($482,190). Thousands separators always; percentages to one decimal; changes signed (+4.2%). Dates are "12 Mar 2025", or relative under a day ("4 min ago"). An empty state says what will appear and offers the one action that fills it. Errors name the field and the fix.
`;

export const CHECKLIST = `Before you ship a screen: one primary per view; figures tabular and right-aligned; status in a word as well as a colour; rows at 32px; hover, focus, selected and disabled on every row and control; chart series in order; checked in dark.
`;

export const SECTION_NOTES: AuthoredPreset['sectionNotes'] = {
  colors: [
    {
      kind: 'note',
      label: 'colour.md',
      body: `Slate neutrals run canvas → surface (sidebar, striped rows) → raised (cards, tables, menus) → elevated (fields, secondary buttons) → active (the selected tab). Cobalt is the only hue in chrome: primary actions, links, the selected row and focus. Each status has a solid for text and icons and a soft fill for badges and row tints. The Data series colour charts only, in order; chart-grid draws their axes and gridlines.
`,
    },
  ],
  typography: [
    {
      kind: 'note',
      label: 'type.md',
      body: `Manrope sets everything, a weight above the usual because it draws light: 500 to read, 600 for labels and buttons, 700 for headings. Body is 13 at 1.5; tables and labels 12; overline 10 tracked wide. Title (32) and display (44) are for headline figures and empty states, not page titles, which use heading (24). Add ds-tabular to any figure that sits in a column or updates live. Code uses the system mono.
`,
    },
  ],
  spacing: [
    {
      kind: 'note',
      label: 'spacing.md',
      body: `A 4px grid. 6–12 inside controls, 16 between fields and inside cards, 24 between panels and as the page gutter, 32–48 only between page sections.
`,
    },
  ],
  radius: [
    {
      kind: 'note',
      label: 'radius.md',
      body: `Small and consistent: 4 for badges and checkboxes, 6 for controls, tabs and table rows, 8 for cards and menus, 12 for dialogs and popovers. Pill only for avatars, status dots and meters.
`,
    },
  ],
  shadows: [
    {
      kind: 'note',
      label: 'shadows.md',
      body: `sm lifts a sticky header or a dragged row; md sits under cards and tables on the canvas; lg is for menus, popovers and dialogs. In dark, surfaces part by tone and shadows only deepen the edge.
`,
    },
  ],
  motion: [
    {
      kind: 'note',
      label: 'motion.md',
      body: `Fast (80) for exits and press, the default (120) for hover and toggles, slow (200) for panels and dialogs arriving. The standard ease decelerates; ease-in is for leaving. No bounce, no parallax, and nothing animates on a data refresh.
`,
    },
  ],
  size: [
    {
      kind: 'note',
      label: 'size.md',
      body: `Controls are 28 in table rows and toolbars, 32 by default and 36 for a page's primary action. Icons are 14 beside 12px text, 16 by default and 18 in the sidebar.
`,
    },
  ],
};

export const USAGE: AuthoredPreset['usage'] = {
  'button.md':
    'In Gridline a toolbar pairs a 16px icon with a short verb ("Export"), and the primary sits at the right end.\n',
  'input.md':
    'Fields fill with elevated and need no outline. Filters keep their label visible above the field.\n',
  'card.md':
    'A card holds one table, one chart or one KPI. Card pads 24px; a KPI card overrides it with !p-4 and a table card with !p-2, which keeps 8px around its rows.\n',
  'badge.md':
    'Gridline squares badges to 4px. Status badges set the matching soft fill with bg-[color:var(--ds-positive-soft)] and friends, and always carry the word.\n',
  'tabs.md':
    'Tabs filter a table or switch a panel; a count in the label ("Overdue 23") saves a click.\n',
  'dialog.md':
    'Dialogs confirm a consequential action or hold a short form; the primary is last and names the action ("Void invoice").\n',
};
