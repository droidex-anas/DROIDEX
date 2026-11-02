import type { AuthoredPreset } from '../authored.js';

export const FEEL = `Potluck is a system for friendly consumer apps people open with friends and family: plans and invites, sign-up sheets, shared lists, community groups. Nunito's rounded letters, warm cream surfaces, soft pastel tints and one basil green make a screen feel like an invitation rather than a form.

- Warm, round and roomy: 15px text at 500, 40px controls, 24px card corners, pill buttons.
- Tints give each thing its own colour (a plan, a dish, a person) without competing with the green.
- Basil green is the next step: Going, Claim, Create. Tomato is only for problems.
- Speak like a friend: first names, contractions, a little warmth, never cute at the cost of clarity.
`;

export const INTERACTION = `- Hover lays lift over a control and pressing lays press; chips fill with accent-soft when pressed (aria-pressed).
- Choices that are one of a few (Going, Maybe, Can't make it) are pill tabs; the chosen one lifts onto raised.
- Claiming, joining and creating answer at once with a toast in plain words ("You're bringing tea. Ama has been told.").
- A toast or dialog arrives on ease-spring in 320ms, with a small overshoot; everything else uses the standard ease in 200ms.
- Errors say what to do in a friendly sentence under the field. Focus is the 3px ring at 55% green, for the keyboard only.
`;

export const LAYOUT = `Content sits in 1080px with 32–40px page padding. Event pages pair a 1fr detail card with a 400px list card; home pages are a greeting, one primary, pill tabs and a three-column grid of plan cards.

- Cards carry a tint band (64–112px) at the top, then 20–24px of padding; nothing nests more than one card deep.
- Lists are rows of a 40px tint tile, a label with a caption, and the action on the right.
- People appear as 32px initial avatars on tints, overlapping in a stack with a raised ring.
- Toasts float centred 24px above the bottom edge.
`;

export const COPY = `Warm and plain. Greet by first name ("Hi Jess"). Buttons say what happens from the user's side: I'll bring it, Start a potluck, Create and invite, Not yet. Use contractions. Dates read "Sat 22 March · 7 pm". Counts are concrete ("3 of 5 dishes", "12 going"). Empty states invite: say what will appear and offer the one action. Errors never blame ("Give it a name your friends will recognise").
`;

export const CHECKLIST = `Before you ship a screen: one green action per view; tints identify, never warn; every avatar has a name nearby or in its title; pill tabs for few choices; toasts confirm every change; contractions and first names; checked in dark.
`;

export const SECTION_NOTES: AuthoredPreset['sectionNotes'] = {
  colors: [
    {
      kind: 'note',
      label: 'colour.md',
      body: `Cream neutrals run canvas (the page) → surface (big background shapes, quiet panels) → raised (cards, dialogs, the chosen tab) → elevated (fields, chips, tab tracks) → active. Basil green is the action colour. The Tints give plans, dishes and people their own colour; set foreground on them, never another tint or the accent. Status keeps its own hues: teal-green for done, honey for warnings, tomato for errors.
`,
    },
  ],
  typography: [
    {
      kind: 'note',
      label: 'type.md',
      body: `Nunito sets everything, a step heavier than usual because its rounded strokes read thin: 500 to read, 600 for labels, 700 for buttons and chips, 800 for headings. Body is 15 at 1.5; labels 14; captions 12. Headings are 22–28; title (36) greets the user on home screens and display (48) is for onboarding. Code uses the system mono.
`,
    },
  ],
  spacing: [
    {
      kind: 'note',
      label: 'spacing.md',
      body: `A 4px grid, spent roomily. 8–12 between chips and rows, 20–24 inside cards, 24 between cards, 32–40 around the page.
`,
    },
  ],
  radius: [
    {
      kind: 'note',
      label: 'radius.md',
      body: `Round everywhere: 6 for small marks, 10 for badges, 14 for fields, tiles and list rows, 20–24 for cards, 32 for dialogs. Buttons, chips, tabs, avatars and toasts are pills.
`,
    },
  ],
  shadows: [
    {
      kind: 'note',
      label: 'shadows.md',
      body: `Soft and warm. sm sits under a primary button and the chosen tab; md under cards on the canvas; lg under toasts, popovers and dialogs. In dark, shadows deepen and tone does the separating.
`,
    },
  ],
  motion: [
    {
      kind: 'note',
      label: 'motion.md',
      body: `Fast (120) to leave, the default (200) for hover, toggles and chips, slow (320) for a dialog or toast to arrive. The Spring easing overshoots a little and is only for arrivals; nothing bounces on hover or while scrolling.
`,
    },
  ],
  size: [
    {
      kind: 'note',
      label: 'size.md',
      body: `Controls are 32 for chips, tabs and avatars, 40 by default and 48 for a lone primary on a phone-width screen. Icons are 16 in text, 20 by default and 24 for empty states and tiles.
`,
    },
  ],
};

export const USAGE: AuthoredPreset['usage'] = {
  'button.md':
    'In Potluck buttons are pills in Nunito 700, and the primary sits on a soft shadow. Pair a 20px icon with a friendly verb ("Start a potluck").\n',
  'input.md':
    'Fields have 14px corners and a label that asks a question ("What are you bringing?"). Hints say why the answer helps.\n',
  'card.md':
    'Cards lead with a tint band and pad 24px. A card with a band overrides the padding with !p-0 and pads its body instead.\n',
  'badge.md':
    'Badges celebrate rather than label: "All dishes claimed", "New". One per card at most.\n',
  'tabs.md':
    'Tabs are pill segments on an elevated track. Use them for a small set of choices, like a reply or a plan filter.\n',
  'dialog.md':
    'Dialogs ask one question with one field; the primary answers it in the first person ("I\'ll bring it").\n',
};
