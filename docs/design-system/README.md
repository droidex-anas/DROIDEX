# DROIDEX design system

The source of truth for how DROIDEX looks, feels and is built. New UI follows it, and existing UI moves onto it surface by surface.

| File | What it holds |
| --- | --- |
| [README.md](README.md) | The brand book: voice, colour, type, spacing, elevation, states, motion, icons, logo |
| [rules.md](rules.md) | The checkable rulebook: type per element, spacing between things, alignment, hit areas, scrollbars, copy, and a pre-ship checklist |
| [feel.md](feel.md) | Taste, visual cues, motion timings and feedback |
| [engineering.md](engineering.md) | How to build it: primitives, popover positioning, dialogs, interaction details, and how the code enforces the tokens |
| [tokens.json](tokens.json) | Every token, both themes: colour, type, spacing, size, radius, shadow, z-index |
| [primitives.css](primitives.css) | Reference CSS for the primitives, written only with tokens |
| [components/](components/) | Guidelines per component: Button, Badge, Input, Card, ToolPanel, PanelRow, Popover, Toast, Alignment, plus a reference implementation of Toast |
| [icons/](icons/) | Proposed icons: the soft folder family and the wider cursors |
| [showcase.html](showcase.html) | Open in a browser: the app rebuilt with the system, plus live demos of every rule in both themes |

## Brand

DROIDEX is one desktop app for all your coding agents. The interface is a quiet, monochrome workspace: a tonal ramp of neutrals carries the chrome, and colour is spent only where it means something — links, skills, status, diffs, and the orange X of the brand mark. Build anything for DROIDEX so that the agents' work is the loudest thing on screen.

## Content fundamentals

- **Plain, direct, second person.** The product talks to *you* about *your* project: "Run Factory Droid, Claude Code, and Codex side by side." Say what happens, not what the feature is called.
- **Sentence case everywhere** — buttons, menu items, section headers ("Environment", "Review changes", "Start a new session"). The only all-caps text is the **DROIDEX** name and `overline` badges (SPEC, AGI).
- **The name is always DROIDEX**, in capitals. Agent and product names keep their own spelling: Factory Droid, Claude Code, Codex.
- **Status reads as a state, not a log.** "Waiting for input", "Still working", "Ready to review", "Done". Tool activity reads like a summary ("Edited 3 files"), never a wall of output.
- **No emoji** in UI copy. Meaning comes from icons in the DROIDEX icon set and from the status hues.
- **Numbers use tabular figures** (counts, diff stats, ahead/behind), set in the sans face — not in mono — unless the number is code.

## Colour

Two themes from the **Default** preset, dark first (the app's default and its `:root`). The values start from what `applyTheme` derives at runtime, with four text colours adjusted so every one reads on every surface.

**Naming.** Tokens have plain semantic names: `bg`, `surface`, `text-muted`, `danger`. Each one is a CSS variable of the same name (`--surface`), derived in `src/lib/themeTokens.ts`, and a Tailwind colour in `tailwind.config.js`, so classes read `bg-surface`, `text-muted` and `border-divider`. Brand colours keep the `brand-` prefix. The code's former `--droid-*` names map like this:

| Former name | CSS variable | Tailwind |
| --- | --- | --- |
| `--droid-bg`, `surface`, `elevated`, `field`, `active`, `raised` | `--bg`, `--surface`, `--elevated`, `--field`, `--active`, `--raised` | `bg-surface`, `hover:bg-active`, `ring-offset-bg` … |
| `--sidebar-bg` | `--sidebar` | `bg-sidebar` |
| `--droid-text` | `--text` | `text-primary`; `bg-text`, `ring-text` where the text colour is a fill |
| `--droid-text-secondary`, `text-muted` | `--text-secondary`, `--text-muted` | `text-secondary`, `text-muted`; `bg-secondary`, `bg-muted`, `placeholder-muted` |
| `--droid-border`, `border-hover` | `--divider`, `--divider-strong` | `border-divider`, `divide-divider`, `bg-divider`, `border-divider-strong` |
| `--droid-green`, `orange`, `red` | `--success`, `--warning`, `--danger` | `text-success`, `bg-danger/10` … |
| `--droid-accent`, `link`, `skill`, `skill-mark`, `visualize-mark`, `ultra`, `update`, `update-hover` | the same name without `droid-` | `text-accent`, `bg-update` … |
| `--droid-shadow`, `--droid-shadow-sm` (`shadow-droid`, `shadow-droid-sm`) | `--shadow-lg`, `--shadow-sm` | `shadow-lg`, `shadow-sm`, which replace Tailwind's defaults |
| Tailwind `rounded`, `-md`, `-lg`, `-xl`, `-2xl` (4/6/8/12/16px) | — | `rounded-xs`, `-sm`, `-md`, `-lg`, `-xl`; `rounded-2xl` is 24px, `rounded-full` unchanged. Tailwind's 2px `rounded-sm` has no token and is written `rounded-[2px]` |

Text colours use `text-primary` rather than `text-text`; the colour itself is also exposed as `text` for fills. The `diff-*` variables already had their final names.

- **Neutral ramp.** Paint the window `bg`, cards and side panels `surface`, hover fills, chips and the composer `elevated`, inputs `field`, and selected rows and pressed controls `active`. The ramp always reads bg < surface < elevated < active, and each step reads about as strongly in light as in dark (hover about 1.13:1 and selection about 1.3:1 against the sidebar), so light rungs step further from the canvas. Floating layers (menus, popovers, tooltips, toasts) use `raised`, which lifts to near-white on light instead of darkening.
- **Text.** `text` for primary copy and icons, `text-secondary` for supporting text and resting icons, `text-muted` for meta, timestamps and placeholders. `text-quiet` is for long text that should recede, such as expanded thinking: it steps below muted on dark and matches it on light, where muted already sits at the floor. All four, and every status colour, hold at least 4.5:1 on every surface, `active` included, in both themes. Don't go lighter than muted for anything that must be read.
- **Space and tone, not lines.** Things separate by space and a tone step, with shadow when floating, never an outline or a divider. State changes use fill. Rows in a grouped card separate by their padding, not a line. `divider` is only for data-table rows and the other meaningful lines in [rule 4](rules.md#lines-that-carry-meaning), such as agent reports and instructions in project chats; `divider-strong` is for the rare split that has to survive a busy area.
- **Accent is neutral.** `accent` is near-white on dark and ink on light. It drives selection, toggles, sliders and the `focus-ring`, never status.
- **Hue means something.** Links `link`; skills `skill` with `skill-mark`; the Visualize chip `visualize-mark`; the top reasoning level `ultra`.
- **Actions with consequences get colour.** `success`, `warning` and `danger` each come with a `-soft` fill. A destructive menu item or button shows `danger` text at rest and a `danger-soft` fill on hover; a danger button fills solid `danger` on hover so the click confirms itself. Approve, merge and accept work the same way in `success`. Status badges pair the soft fill with the text colour. Always pair a status hue with a word or an icon.
- **Diffs** use the `diff-*` tokens (the default "soft" style): `diff-add-fg` / `diff-add-bg` / `diff-add-gutter`, the same for `diff-del-*`, and `diff-hunk-*` for hunk headers.
- **Updates** use `update` with an `on-update` label (white, 6.0:1) in both themes. It is the one solid blue fill in the UI.
- **Brand colours** `brand-ink`, `brand-paper`, `brand-orange` belong to the mark, the app icon, and marketing surfaces. Don't use them for app chrome or state.

Muted and status text are tuned in code against `active`, the surface they read worst on: light `text-muted` #5f5c59, light `success` #1b6943, light `warning` #884f0d, light `danger` #ab2f28, dark `danger` #d6766e. Each keeps its hue and reaches 4.5:1 on `active`.

## Type

The UI uses the platform system face (`sans`: SF Pro on macOS), code uses the native mono stack (`mono`), and the wordmark uses Silkscreen (`pixel`, from Google Fonts, falling back to JetBrains Mono). Users can switch the UI face (Inter, SF Pro, Geist, Helvetica, Georgia, Mono) and the size in Appearance; the base is 14px, and the whole UI scales from it.

- Messages and markdown paragraphs: `prose` (14/22).
- Rows, menu items and most labels: `body` (13/18). Button labels, row titles and selected items: `body-strong`.
- Section headers, meta pills, tooltips: `label` (12/16, medium).
- Timestamps, counts, hints: `caption` (11/16).
- Badges: `overline` (10/12, medium, uppercase, 0.08em).
- Titles: `display` 24/30, `title` 22/28, `heading` 18/22, `subheading` 16/20, all semibold with negative tracking.
- Code, terminal, diffs: `code` (12/18) and `code-sm` (11/16) in `mono`, tabular figures.
- Weights are 400, 500 and 600 only. Medium (500) is the working weight for interactive labels; semibold (600) is for headings. Never bold (700).

### Text by surface

Text doesn't grow or shrink with the window. Each surface uses its own fixed set of styles, and the user's UI size setting in Appearance scales the whole app evenly.

| Surface | Examples | Styles | Controls |
| --- | --- | --- | --- |
| **Dense** | sidebar, menus, popovers, chips, tool panels, tooltips, status lines | `body`, `body-strong`, `label`, `caption`, `overline` | `control-sm`/`control-md`, `icon-sm`/`icon-md`, padding `space-1.5` to `space-3` |
| **Reading** | transcript, markdown, settings pages, dialogs, welcome | `prose`, `display`, `title`, `heading`, `subheading` | `control-md`/`control-lg`, padding `space-4` to `space-6`, a 60–80 character measure for `prose` |

Size changes how the text is set:

- **Smaller text gets more room.** Line height rises as size falls (`caption` 1.45, `body` 1.38), and letter spacing goes from slightly negative at 13–14px to slightly positive at 11px. Interactive text at these sizes is medium (`body-strong`, `label`).
- **Larger text tightens.** Headings run at 1.22–1.27 leading with −0.01 to −0.02em tracking, in semibold.
- **The tracking follows Apple's SF Pro table** for text sizes (13px −0.08, 14px −0.15, 11px +0.06), which browsers don't apply on their own. Headings keep the app's tighter setting.
- **Optical sizes come free.** With the system face, macOS switches between SF Pro Text and SF Pro Display at about 20px, so small text is drawn with the version made for small sizes. Keep `sans` as the default face for this reason.
- **Nothing below 11px**, except `overline` badges.
- **Don't put `prose` on dense surfaces,** and don't use `caption` for reading copy.

The scale is a cleaned-up version of what the code uses today. Sizes 9, 11.5, 12.5, 15, 17, 19 and 20px map to the nearest step above.

## Spacing, size and radius

- **4px grid**, with half steps for dense UI: `space-0.5` (2) through `space-10` (40). Rows are `space-3` × `space-2` with a `space-2.5` gap between icon and label; cards pad `space-4`; sections sit `space-6` apart.
- **Icons** are `icon-md` (16px) by default, `icon-sm` (14px) inside 12–13px text.
- **Controls** are `control-sm` 28px (icon buttons), `control-md` 32px (buttons, triggers), `control-lg` 36px (inputs, primary actions in sheets).
- **Radii nest from small to large.** `radius-md` (8px) is the control radius: buttons, icon buttons, rows, inputs and menu items all use it. `radius-sm` is for shortcut chips and tags sitting inside a control, `radius-lg` for the popovers, menus, tool panels and composer that hold controls, `radius-xl` for cards and sheets, `radius-2xl` for dialogs and large panels, and `radius-full` for the send button, round icon buttons, pills and dots. `radius-xs` is only for inline code and tiny badges. A container's radius is always larger than the radius of what it holds, and radius grows with size (8 → 12 → 16 → 24px), so a big dialog looks as soft as a small button rather than boxy.

## Elevation

Two shadows only. Use `shadow-sm` for floating tool panels, chips and the composer, and `shadow-lg` for floating cards, popovers, menus and dialogs. Both are tuned per theme: dark gets a deep near-black drop with a faint highlight. Light layers are already near white and can't lift by tone, so a soft ink ring and drop carry the lift, enough to see a menu over the sidebar without looking dirty. Tone is the surface edge; never add a border or state ring on top. `shadow-focus-update` is only for the update pill's keyboard focus halo.

## Focus and states

Every interactive thing has the same five states, and none of them adds a line:

| State | What changes |
| --- | --- |
| Rest | Its fill: none for ghost, `elevated` for secondary, `text` for primary, a `-soft` fill for coloured actions |
| Hover | One rung up the ramp (none → `elevated` → `active`), the text steps up to `text`, and the cursor becomes a pointer on anything clickable |
| Pressed / selected | `active` |
| Keyboard focus | A 1.5px `focus-ring`, only on `:focus-visible`. Never show a ring or outline on mouse click. Set `outline: none` on `:focus` and draw the ring only for `:focus-visible` |
| Disabled | 40% opacity, a not-allowed cursor, no hover |

Invalid fields get a `danger-soft` fill and a `caption` hint that says how to fix it, not a danger ring. The composer changes tone when active; only its individual controls get a keyboard focus ring.

## Motion

Short and functional. Use 150ms for colour and icon swaps and 250ms for position, with `cubic-bezier(0.22, 1, 0.36, 1)` (smooth out) for anything that moves or opens. Elements rise 8px as they fade in, and icon swaps cross-fade with a 2px blur. Respect `prefers-reduced-motion` by removing transitions entirely.

## Iconography

Use the **DROIDEX icon set** (`packages/icons`). It has 166 curved 24px outline glyphs with a 1.5px stroke and round caps and joins, and many come in outline and `-filled` pairs. Draw them at `icon-md` 16px or `icon-sm` 14px, coloured `text-secondary` at rest and `text` on hover. The SVG files stroke with `currentColor`, which an `<img>` paints black, so inline the SVG to colour it. Use the filled variant for the selected or active state of the same action. Don't mix in other icon sets, and don't use emoji.

## Logo

The mark is a pixel **DX** monogram built on an 80px grid. On the light tile (`brand-paper`) the D is `brand-ink`, and on the dark tile (`brand-ink`) the D is `brand-paper`. The X is always `brand-orange`. In text the wordmark is set in `wordmark` style (Silkscreen, tracking −0.04em) as DROIDE + X, so the X can take `brand-orange`. Use the files in `assets/brand` (`icon.svg`, `icon-dark.svg`) as they are; don't redraw, recolour or stretch them. The DROIDEX name and mark are trademarks, so forks must use their own.

## Not covered yet

- Only the **Default** preset is here. Midnight, Ember, Ocean and the branded presets in `src/lib/theme.ts` aren't, and neither is the "focused" diff style or the translucent sidebar variant.
- No font files. Silkscreen, Inter and JetBrains Mono are served by Google Fonts, and SF Pro and SF Mono are system faces.
- The component guidelines were drawn from how the app styled its controls, redrawn without borders. The primitives that implement them live in `src/components/ui/`. Older surfaces still carry borders, raw values and per-component focus rings; the migration moves them onto the primitives one surface at a time, and the token ratchet (see [engineering.md](engineering.md#enforcement)) keeps the count falling.
- Not brought in: `assets/brand/dmg-background.*` (installer art), motion as tokens (the timings live in feel.md), and the per-component Tailwind one-offs.
