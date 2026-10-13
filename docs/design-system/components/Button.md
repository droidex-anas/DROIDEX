# Button

Soft, borderless controls: 8px text buttons, square-ish icon buttons, round buttons for send and attach, and coloured buttons for actions with consequences.

- **Shape**: `radius-md` (8px) for text and toolbar icon buttons, `radius-full` for send and other standalone round actions. No borders on any variant.
- **Primary** (`dx-btn-primary`): `text` fill with a `bg` label. Hover dims to 90%. One per surface. The send button is its round icon version.
- **Secondary** (`dx-btn-secondary`): `elevated` fill with a `text-secondary` label. Hover steps the fill to `active` and the label to `text`.
- **Ghost** (`dx-btn-ghost`): no fill and a `text-muted` label. Hover adds `elevated`. Use it for toolbar icons and low-stakes actions.
- **Danger** (`dx-btn-danger`): `danger-soft` fill with a `danger` label at rest. Hover fills solid `danger` with a `bg` label, so the click target confirms what it does. Use it for discard, delete and archive.
- **Success** (`dx-btn-success`): the same pattern in `success`. Use it for approve, merge and accept.
- **Sizes**: `control-md` (32px) with a `body-strong` label and `space-3` padding. `dx-btn-sm` is `control-sm` (28px) with a `label` label and `space-2.5` padding. Icon buttons are square at the control size with a 16px icon.
- **States**: hover changes tone only, never adds a line. Keyboard focus is a 1.5px `focus-ring`, shown only on `:focus-visible`, never on click. Disabled is 40% opacity with a not-allowed cursor. Loading swaps the icon for a spinner and keeps the width.
- **API**: one `Button` with `variant` (primary, secondary, ghost, danger, success), `size` (sm, md, lg), `shape` (default, round) and `icon`. Icon-only buttons need an `aria-label`. The consumer provides the label (sentence case, a verb first).

Implemented by `Button` in `src/components/ui/Button.tsx`.
