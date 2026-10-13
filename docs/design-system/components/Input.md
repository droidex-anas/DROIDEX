# Input

The single-line text field used in settings, sheets and search. It is filled, never outlined.

- `field` fill, no border, `radius-md`, `control-lg` (36px) tall with `space-3` side padding, `body-lg` text in `text`.
- Placeholder: `text-muted`. Hover steps the fill to `active`. Keyboard focus adds the 1.5px `focus-ring`.
- Invalid: `danger-soft` fill with a 1.5px `danger` ring, plus a `caption` hint in `danger` underneath that says how to fix it.
- Label above in `label` style and `text-secondary`, `space-1.5` gap. Never use the placeholder as the label.
- The consumer provides the label, placeholder, value, and error text.

Implemented by `Field` and `Input` in `src/components/ui/Field.tsx`.
