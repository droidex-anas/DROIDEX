import type { AuthoredPreset } from '../authored.js';

export const FEEL = `Margin is a system for products people read from start to finish: magazines, newsletters, essays, long documentation. Newsreader sets the headlines and the prose at a size made for reading; Schibsted Grotesk sets everything a reader operates, from the navigation to the buttons, labels and captions. Ink on stone paper, with one claret for the kicker, the link and the next action.

- The words lead. Chrome stays small, grotesk and muted; the article gets the serif, the size and the space.
- Prose is 18px at 1.7 on a 680px measure, never wider.
- Hierarchy comes from size and weight within one serif, and from ink rules between sections, not boxes.
- Claret marks the kicker, link underlines, the primary action and focus. It never fills behind body text.
`;

export const INTERACTION = `- Links stay ink with a claret underline; hover thickens the underline. Visited links do not change colour.
- Hover lays --ds-lift over a control and press lays --ds-press. Nothing on the page moves while someone reads.
- The selected tab takes a 2px ink underline, never a fill.
- A footnote number is a button: pressing it brings its sidenote to full ink in the rail, and pressing again lets it go.
- Toggles say their state in words: Listen becomes Pause, Save becomes Saved, each with aria-pressed.
- Focus is the 3px ring at 55% claret, for the keyboard only. Motion is 160ms on the standard ease; dialogs arrive in 280ms.
`;

export const LAYOUT = `An article is a 680px column with a 300px rail to its right and 64px between them; the rail holds sidenotes, reading controls and the newsletter card. Order: kicker, headline (title, 42), dek (lead italic), byline with its actions, an ink rule, then prose with a drop cap on the first paragraph.

- Masthead: the italic wordmark, then sections in grotesk; the ink rule closes it.
- Index pages run to 1120px. A month opens with an overline and an ink rule; rows part with hairline borders.
- Pull quotes sit in the column, 32px above and below, set at xl italic with a claret rule.
- Figures go in a card in the rail or full column width, with a kicker number and a caption that says what they show.
`;

export const COPY = `Headlines in sentence case and without a full stop; deks are one or two full sentences. Kickers are one or two words ("Essay", "Interview"), uppercase by the class, not in the source. Bylines read "By Ines Marchetti · 12 March 2025 · 11 min read". Write dates in full in articles and short in lists (12 Mar). Buttons are verbs: Subscribe, Save, Listen, Send the gift. In prose, numbers under ten are words; figures and charts use numerals. Captions say what the figure shows and where the numbers came from.
`;

export const CHECKLIST = `Before you publish a page: the measure stays under 75 characters; one claret action per view besides links; headlines balanced; every figure captioned; footnotes reachable by keyboard; toggles say their state; checked in dark.
`;

export const SECTION_NOTES: AuthoredPreset['sectionNotes'] = {
  colors: [
    {
      kind: 'note',
      label: 'colour.md',
      body: `Stone neutrals run canvas (the page) → surface (asides, quiet panels) → raised (cards, menus, dialogs) → elevated (fields, secondary buttons) → active. Border is the hairline between rows; border-strong is the ink rule under the masthead and above each section, and it inverts to a paper rule in dark. Claret is the only hue in chrome. Danger is a brick red, kept for errors and destructive actions, and always carries a word.
`,
    },
  ],
  typography: [
    {
      kind: 'note',
      label: 'type.md',
      body: `Two families with separate jobs. Newsreader (heading, prose) sets headlines at 500 and reading text at 400, with its true italic for deks and pull quotes. Schibsted Grotesk (sans) sets navigation, buttons, labels, bylines, captions and kickers. Prose is md (18) at relaxed (1.7); the dek is lg (21); article headlines are title (42) or display (56) on a cover story. Interface text is base (15) and sm (13). Kickers and overlines are 2xs, tracked wide and uppercase. Code uses the system mono.
`,
    },
  ],
  spacing: [
    {
      kind: 'note',
      label: 'spacing.md',
      body: `A 4px grid, spent generously. 20 between paragraphs, 32 around a pull quote, 24 inside a card, 40 from the masthead to the kicker, 64 between the column and the rail.
`,
    },
  ],
  radius: [
    {
      kind: 'note',
      label: 'radius.md',
      body: `Nearly square, as print is: 2 for badges and chart bars, 3 for buttons, 4 for fields, 6 for cards and 8 for dialogs. Pill only for avatars.
`,
    },
  ],
  shadows: [
    {
      kind: 'note',
      label: 'shadows.md',
      body: `Paper barely lifts. sm is a 1px shade under cards on the canvas, md sits under a card that floats over an image or figure, lg is for menus and dialogs. Rules do the work that shadows do elsewhere.
`,
    },
  ],
  motion: [
    {
      kind: 'note',
      label: 'motion.md',
      body: `Fast (100) to leave, the default (160) for hover and toggles, slow (280) for a dialog or a drawer. No scroll-linked effects, no parallax, nothing that moves text while it is being read.
`,
    },
  ],
  size: [
    {
      kind: 'note',
      label: 'size.md',
      body: `Controls are 30 in the rail and toolbars, 36 by default and 44 for a subscribe button standing alone. Icons are 16 in bylines, 18 by default and 20 in the masthead. The reading measure is 680; dialogs are 480.
`,
    },
  ],
};

export const USAGE: AuthoredPreset['usage'] = {
  'button.md':
    'In Margin buttons set in Schibsted Grotesk with 3px corners. Article actions (Listen, Save) are quiet buttons with a 16px icon; one primary per view, usually Subscribe.\n',
  'input.md':
    'Fields fill with elevated. Newsletter forms take one field and one button, with the error under the field in a full sentence.\n',
  'card.md':
    'Cards hold the newsletter sign-up, a figure or a related read, never the article itself. Card pads 24px; the rail overrides it with !p-5.\n',
  'badge.md':
    'Margin badges are 2xs uppercase labels with 2px corners: "Members", "New", "Corrected". One per row at most.\n',
  'tabs.md':
    'Tabs underline in ink. Use them to filter an index or to choose a reading option, not to split an article.\n',
  'dialog.md':
    'Dialogs hold a gift, a share or a short form; the primary names the result ("Send the gift").\n',
};
