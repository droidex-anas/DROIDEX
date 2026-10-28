# Badge

A small pill that names a state: passed, waiting, failed, draft.

- `radius-full`, 20px tall, `space-2` side padding, `caption` text in medium weight.
- Each status pairs its soft fill with its text colour: `success-soft` with `success`, `warning-soft` with `warning`, `danger-soft` with `danger`. Neutral uses `elevated` with `text-secondary`.
- Always a word, never colour alone. Add a 12px icon for the states people scan for.
- The consumer provides the status and the label.

Implemented by `Badge` in `src/components/ui/Badge.tsx`.
