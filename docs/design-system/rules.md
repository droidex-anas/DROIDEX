# UI rules

The checkable rulebook. Anyone building DROIDEX UI, person or agent, follows these exactly. When something isn't covered, pick the closest rule. Don't invent a new value.

## The ten rules

1. **Only tokens.** Every colour, size, space, radius and shadow comes from this system. No hex, no `[13.5px]`, no `rounded-[5px]`.
2. **Eleven type styles, nothing else.** See the table below. If text needs to look different, it is a different style, not a tweak.
3. **Three weights.** 400 for reading, 500 for anything you click or label, 600 for headings. Never 300 or 700.
4. **Space and tone, not lines.** Separate things with space and a subtle tone step, never with a line. No outline or stroke around cards, panels, the composer, chips, menus, popovers, sheets, dialogs or inputs, and no divider between rows, under headers, above footers or around groups. Surfaces step in tone (`bg` → `surface` → `elevated` → `raised`), with shadow when they float. Hover, selected and focused things change fill, never add a stroke or ring. A line is allowed only for data tables and the few cases below where it carries meaning tone cannot.
5. **Colour is a signal.** Neutral by default. Colour appears only for links, status, destructive or confirming actions, and the brand mark.
6. **One primary action per surface.** Everything else is secondary or ghost.
7. **Radius grows with size.** 8px controls inside 12px menus inside 16px cards inside 24px dialogs.
8. **Every state, every time.** Rest, hover, pressed, keyboard focus, disabled, plus loading, empty and error where they can happen.
9. **Nothing jumps.** Content that changes size animates or reserves its space. Numbers use tabular figures.
10. **Keyboard first.** Everything reachable, focus visible only for the keyboard, Escape always backs out.

## Lines that carry meaning

Lines are rare. These are the only places one belongs:

- Data tables (Markdown tables, rendered JSON tables, spreadsheet previews) rule their body rows with `divide-y divide-divider` on `<tbody>`, so long rows of cells can be read across.
- Agent-to-agent reports and instruction messages in project chats keep their hairline: it marks who is speaking.
- A dashed drop-target outline is an interaction cue, only while dragging.
- A colour swatch keeps a hairline edge, because an arbitrary user colour must read on any surface.
- Diff lines, gutter markers and the split between a diff's old and new sides encode data.
- `divider-strong` is only for a split that must survive a busy area, such as a docked panel beside the transcript.
- The keyboard focus ring belongs to individual controls, only on `:focus-visible`.

Everything else separates by space and tone:

- **Grouped rows in a card** (settings groups, automation fields) sit on one `surface` card with no divider between them. Each row carries the same vertical padding, so the rhythm alone separates them; an interactive row also takes a soft `elevated` fill on hover. Never swap a divider for a bordered box or a card nested in the card.
- **Lists and menus** separate items by their padding and highlight the hovered or selected one with a fill.
- **Headers, footers and groups** have no hairline. A sidebar or panel footer uses a soft blur/fade where content scrolls under it.
- **Open layers** (menus, popovers, dropdowns) lift off what's beneath by tone and shadow, which is enough to read as on top in both themes.

Leave surfaces that already work without lines alone.

## Type: what to use where

| Element | Style | Size / line | Weight | Colour |
| --- | --- | --- | --- | --- |
| Page title (settings, welcome) | `title` | 22 / 28 | 600 | `text` |
| Markdown h1 | `display` | 24 / 30 | 600 | `text` |
| Dialog and sheet title, markdown h2–h3 | `heading` | 18 / 22 | 600 | `text` |
| Card title, empty-state headline, markdown h4 | `subheading` | 16 / 20 | 600 | `text` |
| Chat messages, markdown body | `prose` | 14 / 22 | 400 | `text` |
| Inputs, sheet body copy | `body-lg` | 14 / 20 | 400 | `text` |
| Rows, menu items, list labels | `body` | 13 / 18 | 400 | `text` |
| Buttons, row titles, selected items | `body-strong` | 13 / 18 | 500 | `text` or `text-secondary` |
| Section headers, tooltips, compact buttons | `label` | 12 / 16 | 500 | `text-muted` (headers), `text` (tooltips) |
| Timestamps, counts, hints, field help | `caption` | 11 / 16 | 400 | `text-muted` |
| Badges | `overline` or `caption` 500 | 10–11 | 500 | status colour |
| Code, terminal | `code` | 12 / 18 mono | 400 | `text` or `text-secondary` |
| Diff gutters, line numbers | `code-sm` | 11 / 16 mono | 400 | `text-muted` |

**Never use:**

- sizes 9, 10 (except badges), 11.5, 12.5, 15, 17, 19 or 20px;
- bold (700), light (300), or italic in UI chrome;
- uppercase for anything but `overline` badges;
- `prose` in menus or rows, or `caption` for anything people read for more than a glance;
- mono for numbers that aren't code (use tabular figures in the sans face instead);
- centred text in lists, menus or forms (centre only empty states and the welcome screen);
- more than three text styles in one component.

## Spacing between things

Spacing is how DROIDEX groups things, instead of lines. The closer two things are, the more they belong together.

| Between | Space |
| --- | --- |
| Icon and its label | `space-1.5` (buttons, chips), `space-2` (menu items), `space-2.5` (rows) |
| Label and its field | `space-1.5` |
| Field and its hint | `space-1.5` |
| Items in a menu | 0, so hit areas touch |
| Rows in a list | 0, since rows carry their own padding |
| Rows in a grouped card | 0, each row `space-3.5` top and bottom (`space-3` in a dense card such as theme colours); no divider |
| Buttons in a group | `space-2` |
| Fields in a form | `space-4` |
| Title and body in a card or dialog | `space-1` (subtitle), `space-3` (body) |
| Body and actions | `space-4` (cards), `space-6` (dialogs) |
| Groups within a panel | `space-4` |
| Sections on a page | `space-6` to `space-8` |
| Chat turns | `space-6`; tool calls inside one turn `space-2` |
| Window edge to content | `space-4` (panels), `space-8` (pages) |

**Inside components:**

| Component | Padding |
| --- | --- |
| Buttons | `space-3` sides (`space-2.5` small) |
| Rows | `space-3` × `space-2` |
| Menus | `space-1.5` around the items; items `space-2` × `space-1.5` |
| Cards | `space-4` |
| Dialogs | `space-6` |
| Tool panels | `space-3` |
| The composer | `space-3` |

## Alignment: the ruler test

Every surface is built on the same few vertical lines, so measuring any screen with a ruler gives the same numbers.

```
panel edge
│ 8px gutter: hover and selected fills start here
│ │ 12px item padding
│ │ │ 20px content edge: text, headers, icons and dividers all start here
│ │ │ │ 16px icon column, then a 10px gap
│ │ │ │ │ 46px label edge
▼ ▼ ▼ ▼ ▼
│ ┌───────────────────────────────┐
│ │  ◇  feature/history      2 ↑  │  trailing meta ends 20px from the right edge
│ └───────────────────────────────┘
```

- **Panel gutter `space-2` (8px).** Hover and selected fills sit 8px inside the panel edge on every side panel, menu and list.
- **Content edge 20px.** The item padding (`space-3`) inside the gutter puts every text start, section header, icon and divider 20px from the panel edge. The right side mirrors it: trailing meta, counts and chevrons end 20px from the right edge.
- **Icon column.** Icons sit in a fixed 16px column. In a list where some rows have icons, a row without one keeps an empty 16px slot, so every label starts at the same x (46px).
- **Headers align to the content edge**, at the same x as the row icons. Never indent them to the labels.
- **Align text to text, and boxes to boxes.**
  - A control with a visible fill (primary or secondary button, input, card) aligns its *box* to the content edge.
  - A control that's invisible at rest (ghost button, row, link) aligns its *text* to the content edge, and its padding hangs into the gutter.
  
  So a ghost "New session" row and the section header above it start their text at the same x, even though only one of them has a hover box.
- **Different lengths, same edge.** A 20-character label above an 8-character button looks right when both start on the content edge. It looks wrong when one is centred, when one aligns by its box and the other by its text, or when the button is stretched to match the label. Never centre stacked items of different lengths in a sidebar or panel.
- **Widths.** Buttons size to their label with `space-3` padding and a 64px minimum. Side-by-side buttons are equal width only when they're equal choices, as in a segmented control. Full-width buttons are only for sheets on narrow panels, with the label centred.
- **Vertical alignment.**
  - Single-line items centre vertically.
  - Mixed sizes on one line, such as a header and its trailing caption, align on the baseline, not the centre.
  - In multi-line rows, the icon centres on the first line, not on the whole row.
- **Numbers align right** in columns, in tabular figures, so the digits line up.
- **One rhythm.** Every component height is even and on the 4px grid (20, 28, 32, 36), and every line height is even (12, 16, 18, 20, 22). Odd sizes are what make things look a pixel off.

## Text alignment

| Content | Alignment |
| --- | --- |
| Labels, rows, menus, forms, messages, headings (the default) | Left |
| Trailing meta, numbers in columns, timestamps, shortcuts | Right |
| Empty states, the welcome screen, badges, icon-only buttons | Centre |
| Anything | Never justified |

## Hit areas and click distance

- **The hover shape is the hit shape.** What lights up on hover is exactly what's clickable, edge to edge. There are no dead pixels inside a highlighted row and no clickable area outside it.
- **Minimum 28×28px** (`control-sm`) for anything clickable, even a 14px icon. WCAG's minimum is 24px.
- **No dead zones in lists and menus.** Items touch (0 gap) and get their spacing from padding, so moving the pointer down a menu never crosses a gap where nothing is highlighted.
- **Toolbars.** Icon buttons sit `space-1` apart. Keep destructive actions at least `space-3` away from frequent ones, or behind a menu.
- **Short travel.** Put an action next to what it acts on:
  - row actions inside the row, at its trailing edge;
  - a menu 4–6px from its trigger;
  - confirm buttons at the bottom-right of a dialog, where the eye ends up.
- **Edges are infinite.** A control touching the window edge extends its hit area to the edge, so people can throw the pointer at it.
- **Hover-revealed actions:**
  - reserve their space, so nothing shifts when they appear;
  - show on row hover *and* on `:focus-within`;
  - fade in over 120ms;
  - are never the only way to do the action (also offer it in the context menu or as a shortcut).
- **Press, then act.** Buttons act on release (`click`). Menus also support press, drag and release, as on macOS. A drag only starts after 4px of movement, so a slightly shaky click never becomes a drag.
- **One action per click.** Disable send, create and merge while they're pending, so a double-click can't fire twice.

## Scrollbars

- **Hidden at rest.** The thumb appears only while scrolling (or being dragged) and fades out about 800ms after scrolling stops. There is never a visible track.
- **When it shows,** it's a 6px pill in `text` at 16% (26% while dragged), with no arrows and no track.
- **Reserve the gutter** with `scrollbar-gutter: stable`, so content never shifts when scrolling becomes possible or when a dialog locks scrolling.
- **Edge fades** (8–12px masks) are what tell people there's more, not the scrollbar.
- **Never `overflow: scroll`.** Always `auto`, so short content gets no scrollbar at all.

## Sizes

| Thing | Size |
| --- | --- |
| Controls | `control-sm` 28 (icon buttons, compact), `control-md` 32 (buttons, triggers, tabs), `control-lg` 36 (inputs, sheet actions) |
| Icons | `icon-sm` 14 in 12–13px text, `icon-md` 16 in controls, `icon-lg` 20 in empty states |
| Menus | 200–320 wide, items 30 tall |
| Tooltips | up to 240 wide |
| Dialogs | 440 (confirm), 560 (form), 720 (content), `radius-2xl` |
| Command palette | 576 (`max-w-palette`), `radius-2xl` |
| Sidebar | 280 (fixed today) |
| Reading column | 60–80 characters |

## Colour budget

On any one screen:

- one accent use for selection;
- status colours only where a status exists;
- at most one coloured action in view.

If a screen has more than three colours besides the neutrals, something is decorative and should go.

## Copy

- **Sentence case.** "Start a new session", not "Start New Session".
- **Buttons say what happens:** "Create pull request", not "OK" or "Submit". Destructive buttons name the thing: "Archive session".
- **Errors say what to do next:** "Branch names can't contain spaces", not "Invalid input".
- **No exclamation marks, no emoji, no "please"** in UI chrome.
- **Status words are states:** Waiting, Working, Ready to review, Done.
- **Numbers and units:** "2m ago", "14 files", "+42 −7".

## Before shipping a screen

- [ ] Only tokens, and only the type styles above.
- [ ] Things separate by space and tone, with shadow when floating. No outlines and no row, header, footer or group dividers; lines only for data tables and the meaningful cases in rule 4.
- [ ] Hover, pressed, keyboard focus and disabled all checked, with no ring on mouse click.
- [ ] Loading, empty and error states designed, not left blank.
- [ ] Popovers stay inside the window at every edge.
- [ ] Ruler test: text, icons and headers start on the content edge, and trailing items end on it.
- [ ] Every hover shape matches its hit area, with no dead gaps between list or menu items.
- [ ] No visible scrollbars at rest, and nothing shifts when one appears.
- [ ] Both themes checked, and every text pair reads (4.5:1).
- [ ] Works at the smallest window size, with long names truncated rather than wrapping.
- [ ] Works with reduced motion on.
- [ ] Usable with the keyboard alone.
