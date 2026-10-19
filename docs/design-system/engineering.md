# Design engineering

How to build DROIDEX components so they look right, stay consistent and get reused rather than rewritten. The other sections say what things look like; this one says how to build them.

## Build from primitives

- **One component per pattern.** There is one `Button`, one `Menu`, one `Popover`, one `Tooltip`, one `Row`, one `Field`, one `Badge`, all in `src/components/ui/`. A new screen composes these; it doesn't restyle a `<button>` with its own Tailwind string. If a variant is missing, add it to the primitive.
- **Variants are props, not classes.** `<Button variant="danger" size="sm" icon={Trash}>`. Inside, map props to classes in one place (a `cva`-style table). Callers never pass colour, radius or padding classes.
- **Tokens only.** No hex values, no `text-[12.5px]`, no `rounded-[5px]`, no `p-[7px]`. If a value isn't a token, either use the nearest token or add a token on purpose. The `design-tokens` lint rule (`tools/eslint/design-tokens.mjs`) keeps it that way; see [Enforcement](#enforcement).
- **Composition over configuration.** Build `Menu` from `Menu.Item`, `Menu.Divider`, `Menu.Shortcut` children rather than an `items={[…]}` array with a dozen flags. Callers can then put anything in a slot without the primitive growing a prop for it.
- **States live on data attributes.** Set `data-state="open"`, `data-selected`, `data-disabled`, `data-danger` and style from them. The markup then says what state it's in, tests can query it, and parents can react to it.
- **Forward refs and spread the rest.** Every primitive forwards its ref (popovers need anchors) and passes unknown props (`aria-*`, `data-*`, handlers) to the root element. Merge a caller's `className` last, and only for layout (margin, width, grid placement), never for look.
- **Accessible by default.** Icon-only buttons need an `aria-label`. Menus use `role="menu"` with arrow keys, Home/End and type-ahead. Dialogs trap focus and return it to the trigger on close. Everything works with the keyboard alone.

## Popovers, menus and dropdowns

All floating UI (menus, pickers, tooltips, the model selector, the branch menu) goes through **one positioning hook**, so nothing opens off-screen and nothing positions itself by hand.

- **Preferred side, then flip.** Each popover names a preferred placement (`bottom-start` for menus under a trigger, `top` for the composer's menus, `right-start` for sidebar submenus). If it doesn't fit there, it flips to the opposite side. If neither fits, it takes the side with the most room.
- **Shift to stay inside.** After placing, slide it along the anchor's edge so it stays at least `space-2` (8px) inside the window.
- **Size to the space.** Set `max-height` to the room left on its side minus 8px and scroll inside. Never let the window scroll or clip it. Keep width 200–320px for menus, and at least the trigger's width for selects.
- **Offset from the anchor.** 4–6px between trigger and popover, 8px for tooltips.
- **Open from the anchor.** Set `transform-origin` to the anchor side of the final placement, and fade in while rising 4px from that side (120–150ms, `ease-smooth-out`). A popover that flipped upward animates from below.
- **Animate from the side it actually landed on.** A tooltip or menu that flipped at the window edge must animate from its real side, not the one you asked for. Have the positioning hook write the final placement to `data-side="top|bottom|left|right"` and key the entrance animation off that. CSS anchored container queries (`@container anchored(fallback: flip-block)`) will do this in pure CSS, but they're newer than the Chromium in Electron 39, so use `data-side` for now.
- **Portal and layer.** Render into a body-level portal so a parent's `overflow: hidden` or transform can't clip it. Give the layers fixed z-index tokens: `z-popover`, then `z-dialog`, then `z-toast`, then `z-tooltip`.
- **Track the anchor.** Reposition on scroll, resize and anchor size changes. Close when the anchor scrolls out of view.
- **Close cleanly.** Escape, a click outside, choosing an item, and focus leaving all close it. Focus then returns to the trigger.
- **Submenus** open to the right and flip left at the edge. Leave a short hover delay (about 100ms) so moving the mouse diagonally into the submenu doesn't close it.

In code this is `usePopoverPosition` (`src/components/ui/usePopoverPosition.ts`), built on `@floating-ui/react` (`offset`, `flip`, `shift`, `size`, `hide`, `autoUpdate`). `Popover`, `Menu` and `Tooltip` use it; never write per-component positioning maths.

## Dialogs and sheets

- Centre dialogs. Cap their height at the window height minus `space-8` above and below, and scroll the body while the title and actions stay put.
- Sheets slide in from the side they belong to and take the full height.
- Use `radius-2xl`, `shadow-lg` and `space-6` padding. Put the title in `heading`, with actions bottom-right: the primary action last, a danger action on the left.
- Darken the backdrop (`bg` at 60%). Don't blur it.
- **Blur on its own layer.** Wherever blur is used (the frosted sidebar, a translucent toolbar), put `backdrop-filter` on a `::before` pseudo-layer behind the content, not on the element itself. The content then repaints without re-running the blur, which keeps animations smooth.

## Spacing inside components

- **Padding ≥ gap.** A container's padding is at least the gap between its children, or the content looks like it's spilling out.
- **Nested radius = outer radius − padding.** A 12px popover with 6px padding holds 6–8px items. That's why menus use `radius-lg` with `space-1.5` padding and `radius-md` items.
- **Icon + label gap**: `space-1.5` in buttons and chips, `space-2` in menu items, `space-2.5` in rows.
- **Control padding**: `space-3` sides on `control-md`, `space-2.5` on `control-sm`. Icon-only controls are square.
- **Groups.** Use `space-1` to `space-2` between items in a group and `space-4` to `space-6` between groups. Never a line between rows, around groups, under headers or above footers: rows in a grouped card keep the same vertical padding and an interactive row takes an `elevated` fill on hover. Only data-table bodies (`<tbody>`) use `divide-y divide-divider`.
- **Optical alignment.** Line up the text edge, not the box edge: a row's label sits on the same vertical line as the section header above it.

## Sizing where it matters

| Thing | Size |
| --- | --- |
| Click target | 28px minimum (`control-sm`), even when the icon is 14px |
| Buttons and triggers | `control-md` 32px |
| Inputs and sheet actions | `control-lg` 36px |
| Icons | 16px in controls, 14px inside 12–13px text |
| Menus | 200–320px wide, items 30px tall |
| Tooltips | max 240px wide, `label` text |
| Dialogs | 440px (confirm), 560px (form), 720px (content) |
| Command palette | 576px |
| Reading column | `max-w-2xl` (672px) transcript rows; replies fill the row |

Truncate single-line labels with an ellipsis and show the full text in a tooltip. Never let a label wrap inside a control.

## Colour in actions

Neutral by default, colour when the action has consequences:

- **Destructive** (archive, discard, delete): `danger` text and icon at rest, a `danger-soft` highlight on hover in menus, a solid `danger` fill on hover for buttons. Put them last in a menu, separated with space.
- **Confirming** (approve, merge, accept): the same pattern in `success`.
- **Needs attention** (waiting for input, limits): `warning` text on `warning-soft`.
- Never colour an action just for variety. The quieter the rest of the UI, the more these colours mean.

## Removing borders from the app

Do it in order, one surface at a time:

1. **Keep meaningful lines.** Preserve the explicit cases in [rule 4](rules.md#lines-that-carry-meaning), including data tables and project-chat agent reports and instructions. `divider` is never a row, group, header or footer edge.
2. **Remove the focus outlines.** `src/index.css` sets `outline: none` on `:focus` and draws the 1.5px `focus-ring` on `:focus-visible`. Delete per-component rings such as `focus-visible:ring-1 ring-accent/60` so the global ring shows; a control that must draw its own uses `ring-focus-ring`.
3. **Strip control borders.** Buttons, inputs, chips and segmented controls lose `border` and get their fill from the ramp.
4. **Strip surface borders and row dividers.** Cards, panels, popovers and the composer separate by a tone step, and the rows inside them by space. Add `shadow-sm`/`shadow-lg` only when floating. Hover, active and focused surfaces change fill, not stroke or ring; the composer's active state is a colour change only.
5. **Search for leftovers.** Search for `divide-`, `border-divider`, `border `, `ring-` and `outline`. Remove decorative edges, not meaningful ones. Scrolling content under a sidebar or panel footer gets a soft blur/fade, never a hairline. Leave already-borderless surfaces alone.

## Interaction details

Small engineering choices that decide whether the app feels finished.

**Moving and animating**

- **Move live embeds with `moveBefore()`.** Moving a playing iframe, video or browser surface with `appendChild` removes it and inserts it again, which reloads it. `moveBefore()` moves it while it keeps its state (Electron 39's Chromium supports it). Use it when docking or undocking the browser pane or a media player:

  ```ts
  if ("moveBefore" in slot) slot.moveBefore(player, null);
  else slot.insertBefore(player, null);
  ```

- **Keep text crisp in animated containers.** Motion's `layout` scales children like an image while the container animates, so text squashes. Put `layout="position"` on text inside a `layout` container, so it moves with the box but keeps its real size:

  ```tsx
  <motion.div layout>
    <motion.p layout="position">Your text</motion.p>
  </motion.div>
  ```

- **Shared elements.** Use `layoutId` when a thing moves between places (a session row into the header, a chip into the composer). Use `AnimatePresence mode="popLayout"` so leaving items don't hold their space.

**Hover and hit areas**

- **Hover only where hovering exists.** Wrap hover styles in `@media (hover: hover)` so touch and pen don't get stuck hover states.
- **Hit areas bigger than icons.** A 14px icon still gets a 28px target. Expand with padding or a `::before` inset, not by enlarging the icon.

**Text and inputs**

- **Inline links** use `.inline-link` (`src/index.css`): coloured text that underlines on hover, the same as Markdown links. Give it `text-link` for a URL, or the entity's own colour for an in-app name; don't hand-roll `underline` and `hover:` styles.
- **Text wrapping.** Use `text-wrap: balance` on headings and `text-wrap: pretty` on `prose`, so no orphaned single words.
- **Truncate where the meaning is.** Paths truncate in the middle (`src/…/Popover.tsx`), branch names at the end. Show the full value in a tooltip.
- **Inputs for code-ish values** (branch names, paths, commands) get `spellCheck={false} autoCorrect="off" autoCapitalize="off"`.
- **Respect IME.** Enter-to-send checks `!e.nativeEvent.isComposing`, or people typing Japanese, Chinese or Korean send half a word.

**Native app behaviour**

- **Chrome isn't text.** Use `user-select: none` on buttons, rows, tabs and headers. Keep selection on content (messages, code, diffs).
- **Drag regions.** Title bars and toolbars are `-webkit-app-region: drag`, and every control inside them is `no-drag`.

**Scrolling and performance**

- **Hidden scrollbars.** Style every scroller the same way: reserve the gutter, keep the thumb transparent, and reveal it only while scrolling.

  ```css
  .scroller { overflow: auto; scrollbar-gutter: stable; overscroll-behavior: contain; }
  .scroller::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  .scroller::-webkit-scrollbar-thumb { background: transparent; border-radius: 9999px; }
  .scroller[data-scrolling]::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--text) 16%, transparent);
  }
  ```

  `src/index.css` applies this to every scroller. `useScrolling` (`src/components/ui/useScrolling.ts`) sets `data-scrolling` on scroll and removes it 800ms after the last event.
- **No layout shift when a dialog opens.** Scroll-lock libraries set `overflow: hidden`, which removes the scrollbar and shifts everything sideways by its width. Reserving the gutter (`scrollbar-gutter: stable` on `html` and on any pane a dialog locks) means nothing moves.

- **Stable scroll.** Use `scrollbar-gutter: stable` on panes whose content changes length. Use `overflow-anchor` (or manual anchoring) so content loading above doesn't push the reading position.
- **Long lists.** Virtualize anything that can pass a few hundred rows (sessions, files, search results). Use `content-visibility: auto` on old transcript turns.
- **Measure with observers.** Use `ResizeObserver` and `IntersectionObserver`, never polling or reading layout in a loop. Use `will-change` only while something is animating.

**Fonts**

- **Ship fonts with the app.** DROIDEX loads Inter, JetBrains Mono and Silkscreen from Google Fonts, so offline or packaged sessions fall back and the text jumps when the font arrives. Bundle the `woff2` files in the app instead: no network, no swap.
- **If a web font must load late, make the fallback the same size.** Define a fallback `@font-face` from a local font with `size-adjust`, `ascent-override`, `descent-override` and `line-gap-override` set so the fallback takes exactly the same space as the real font. The swap then changes the letterforms, but nothing moves. Measure the values with a tool such as Capsize or fontaine; don't guess them.

**Focus and state**

- **Focus after removal.** After deleting or archiving a row, move focus to the next row (or the previous one at the end), never back to `body`.
- **Explain disabled.** A disabled control shows a tooltip saying why ("Commit your changes first").
- **Search feels instant.** The input updates on every keystroke. Debounce only the query (100–150ms), and keep the old results visible until the new ones arrive.
- **Remember the layout.** Panel sizes, collapsed sections, the last selected tab and scroll positions survive a restart.
- **Keyboard shortcuts.** Show them in menus and tooltips with Mac glyphs (⌘ ⇧ ⌥ ⌃ ↩), right-aligned in a `radius-sm` chip. One shortcut does one thing everywhere.

## Enforcement

- **Where tokens live.** `src/lib/themeTokens.ts` derives every colour and shadow for each theme, and `applyTheme` in `src/lib/theme.ts` writes them on `:root`. `tailwind.config.js` exposes them as classes: colours, type styles, control and icon sizes, radius, shadows and z-index. `src/index.css` holds the base layer: the focus ring and hidden scrollbars. The contrast tests in `src/lib/theme.test.ts` hold every text pair at 4.5:1 and keep light-theme hover and selection fills about as visible as dark ones.
- **The lint rule.** `tools/eslint/design-tokens.mjs` flags raw hex, Tailwind palette colours, arbitrary values, border edges (including `border-divider`), resting rings/outlines, weights outside 400–600, non-token focus colours, and `uppercase`. Edge resets and `focus-visible:` edges are allowed; `divide-y` / `divide-x` count as edges too, except with same-variant `divide-divider` on a data table's `<tbody>` or `<tr>`. `npm run lint` reports only what exceeds a file's count in `tools/design-token-baseline.json`.
- **Meaningful edges.** For the explicit cases in [rule 4](rules.md#lines-that-carry-meaning), put `eslint-disable-next-line design-policy/design-tokens -- <allowed case and why>` immediately before the class value (use a JSX comment inside markup). Name the case, for example `agent-to-agent project-chat instruction: marks the speaker` or `dashed drop target: drag cue`. Both lint and the ratchet respect the directive. Never exempt a whole file or a decorative surface.
- **The ratchet.** `npm run quality:design-tokens` (`tools/check-design-tokens.mjs`) counts every violation and compares it with the baseline. It runs in CI and in the pre-commit hook when `.tsx` files are staged. The baseline only goes down: after removing violations, lower it with `npm run quality:design-tokens -- --update-baseline` and commit the new numbers.
- **A deliberate rise.** `--update-baseline --force` writes through a rise once, for a deliberate change such as a stricter matcher. It prints each raise; say why in the pull request. Never use it to land new violations.
