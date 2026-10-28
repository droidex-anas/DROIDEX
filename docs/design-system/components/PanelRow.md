# PanelRow

The context panel's one row language: a section header, rows of a 16px icon, a 13px label and optional meta. Space separates sections.

- **SectionHeader**: `label` text in `text-muted`, `space-4` above and `space-1` below, with an optional trailing `caption`.
- **Row**: `space-2` × `space-3` padding, a `space-2.5` gap and `radius-md`. The icon is `icon-md` in `text-muted` (secondary on hover), the label is `body` in `text` and truncates, and meta is 12px muted in tabular figures.
- Hover is `elevated`. The active row is `active`. Neither adds a line.
- A row without an action renders as plain text, not a button.
- **No divider**: rows separate by their padding and highlight with a fill. Never a line between rows, under the panel header, above its footer or around a section. Scrolling content under the footer gets a soft blur/fade instead.
- The consumer provides the icon, label, meta, `onClick` and active state.

Implemented by `Row` and `SectionHeader` in `src/components/ui/Row.tsx`.
