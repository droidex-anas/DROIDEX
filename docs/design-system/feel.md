# Feel and motion

How DROIDEX should feel: calm, quick and certain. The UI stays quiet so the agents' work is the loudest thing on screen. Smoothness and small visual cues do the work that colour and decoration do in louder apps.

## Taste, in principles

- **Restraint is the style.** Every pixel either helps someone act or understand, or it goes. When in doubt, remove it: a line, a colour, a label, an animation.
- **Hierarchy through tone, not decoration.** Use weight, size, `text` / `text-secondary` / `text-muted` and the surface ramp. Don't reach for boxes, borders, colour or icons to make something stand out.
- **Meaningful lines only.** Keep the explicit cases in [rule 4](rules.md#lines-that-carry-meaning). Agent reports and instructions in project chats keep their speaker-marking hairlines. Headers, footers and groups have no line; scrolling content under a sidebar or panel footer gets a soft blur/fade.
- **Density with air.** DROIDEX is a pro tool, so show a lot, but give every group room. Tight inside a group, generous between groups.
- **Consistency beats cleverness.** The same thing looks and behaves the same everywhere. One menu, one row, one way to confirm, one way to close.
- **The details are the product.** Alignment to the pixel, truncation that keeps the useful end of a path, numbers that don't jitter, focus that lands in the right place. People can't name these, but they feel them.
- **Fast is a feature.** Respond to input within one frame, show something in under 100ms, and never block typing.
- **Native, not webby.** It's a Mac app, so behave like one: no text selection on chrome, no I-beam cursor on buttons, the default cursor on controls rather than a pointer, menus that blink on select, and Escape that always backs out.

## Visual cues that carry meaning

Small cues tell people what's happening. Use words, weight and icons, not coloured dots: green and red dots scattered across rows read as noise.

- **Live work.** A shimmer sweeps across the status text ("Working…") or the agent avatar, and stops the moment the work does.
- **Needs you.** The row's trailing text says "Waiting" in `warning`. No dot, no toast, no bouncing.
- **Done.** The trailing text says "Ready" in `text-muted`. Once you've opened it, it settles back to its timestamp.
- **Unread.** The title is `body-strong` (500). Read titles are `body` (400). Weight alone carries it.
- **Selected.** An `active` fill. That's all.
- **Results and errors.** A toast whose colour lives only in its 16px status icon (see [components/Toast.md](components/Toast.md)).
- **Drop target.** An `elevated` fill and a dashed `divider-strong` outline while something is dragged over it. This is the one place a dashed line is allowed.
- **Copied.** The copy icon swaps to a check for 1.2s, cross-fading with a 2px blur. No toast.

## Motion

Motion explains change. It shows where something came from, where it went, and that your input landed. It is never decoration.

| What | Duration | Easing |
| --- | --- | --- |
| Hover and colour changes | 120–150ms | `ease-out` |
| Press, hover lift, toggles (anything that can reverse mid-way) | spring | stiffness 520, damping 38 |
| Icon and text swaps | 150–200ms | `ease-in-out`, cross-fade with a 2px blur |
| Popovers and menus opening | 120–150ms | `cubic-bezier(0.22, 1, 0.36, 1)` (smooth out) |
| Popovers and menus closing | 80–100ms | `ease-in`, fade only |
| Panels, sheets, the sidebar | 220–280ms | smooth out, or a spring (stiffness 400, damping 40) |
| Dialogs | 180ms in, 120ms out | smooth out / `ease-in` |
| List items arriving | 200ms each, staggered 30ms | smooth out, rising 8px |
| Layout changes (resizing, reflowing, reordering) | spring, or 400–600ms `ease-out` for big moves | Motion `layout` / `layoutId` |
| Expand and collapse | 200–250ms | smooth out, via `grid-template-rows` |

**Rules:**

- **Exits are faster than entrances.** People wait for what's arriving, not for what's leaving.
- **Animate from the source.** A menu grows from its trigger (`transform-origin` on the anchor side), and a sheet slides from its edge.
- **Only animate `transform` and `opacity`.** Never width, height, top or left on anything big. Use Motion `layout` when the size has to change.
- **Everything is interruptible.** People reverse halfway: they hover off, press and release, open and close. Use springs for anything that can reverse, because a spring keeps the element's current velocity instead of restarting from zero, so rapid changes stay smooth:

  ```tsx
  transition={{ type: "spring", stiffness: 520, damping: 38 }}
  ```
- **Small distances.** Things move 4–8px, not 20–40px. Scale from 0.96, never from 0.
- **Nothing animates on first paint**, except the welcome screen's gentle rise.
- **High-frequency actions don't animate at all**, such as switching sessions with the keyboard, typing, or scrolling. If someone does it 50 times a day, make it instant.
- **Reduced motion means no movement**: cross-fades only, or nothing.

## Things that move should keep their identity

- **Reordering.** When sessions re-sort, cards rearrange or panels swap, items should travel, not pop into new slots. Keep each one mounted with a stable key or `layoutId`, and animate its position, size and corner radius together. The interface then looks like it's rearranging itself, not re-rendering.

  ```tsx
  <motion.div
    layoutId={card.id}
    animate={{ left, top, width, height, borderRadius }}
    transition={{ duration: 0.6, ease: "easeOut" }}
  />
  ```

  For big moves, a slightly curved path feels more physical than a straight line. Motion's `arc()` helper does this, if the Motion version in use has it; otherwise use x/y keyframes with a small offset at the midpoint. Keep the curve subtle.
- **Expand and collapse.** Never animate `height: auto` with JavaScript measurements. Wrap the content in a grid and animate `grid-template-rows: 0fr` → `1fr`, with `overflow: hidden` on the child. Electron 39's Chromium also supports `interpolate-size: allow-keywords`, which lets `height: auto` transition directly.
- **Text stays text.** Inside a resizing container, text moves but never stretches (`layout="position"`; see [engineering.md](engineering.md)).

## Edges and scrolling

- **Let edges feel physical.** Keep macOS's native rubber-band bounce at scroll edges. Don't disable it with `overscroll-behavior: none`, and don't fake a bounce with JavaScript wheel handlers, which fight trackpad momentum. Use `overscroll-behavior: contain` on inner scrollers, so reaching the end of a panel doesn't start scrolling the page behind it.
- **Scrollbars stay out of sight.** They appear while scrolling and fade away after (see [rules.md](rules.md)). Edge fades carry the "there's more" cue.

## Feedback that feels good

- **Press.** Buttons scale to 0.97 on press (60ms) and spring back on release. The pressed state shows at once, before any network call.
- **Menu select blink.** When an item is chosen, it blinks once before the menu closes: highlight off for 90ms, on for 90ms, then close. Like macOS, it confirms the click landed on the right item.

  ```ts
  async function select(item) {
    setHighlighted(false); await wait(90);
    setHighlighted(true);  await wait(90);
    closeMenu(); item.onSelect();
  }
  ```

- **Hover intent.** Tooltips wait 500ms the first time, then show instantly while moving between items, and hide after 100ms. Submenus open after 100ms and stay open while the pointer heads toward them.
- **Optimistic UI.** Rename, pin, archive and settle update instantly and roll back with a quiet message if they fail. Never put a spinner on something that almost always works.
- **Loading.** Under 300ms, show nothing. Between 300ms and 2s, show a skeleton in the shape of what's coming (shimmering `elevated` blocks). Over 2s, add words saying what's happening. Use spinners only inside buttons.
- **Streaming text.** Grow the message in place without shifting the layout above it. Keep the scroll pinned to the bottom only while the user is already there.
- **Snap points.** Resizable splits (the utility pane, the review panel) snap to 25 / 50 / 75% within 12px of each point, and the handle eases into place on release with a short spring. Double-click the handle to reset it.
- **Nothing jumps.** Reserve space for counts, badges and images. Use tabular figures for anything that ticks.
- **Scroll.** Fade the edges of scrollers (8–12px masks) instead of drawing lines. Hide scrollbars until scrolling, and keep scroll positions when switching back to a session.

## Show, don't just tell

Chat answers don't always have to end as plain text. When an agent's result is something to explore, such as a diff, a table, a plan, a set of options or a chart, render it as interactive UI in the transcript (DROIDEX's app blocks), not a paragraph describing it.

- Make it explorable: sortable tables, collapsible plans, diffs you can open, options you can pick.
- It uses the same primitives and tokens as the rest of the app, so it never looks like an embed.
- Keep a text fallback for copy, search and export.
