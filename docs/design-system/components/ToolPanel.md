# ToolPanel

The inset panel that holds a tool call's output in the transcript, such as a command, a diff or a search.

- `surface` fill, `radius-lg`, `shadow-sm`. No border: the edge comes from the shadow.
- Header row: a 16px icon, a `body` summary and a trailing status badge (Passed, Failed) in its soft colour.
- Body: `code` text in `text-secondary`, `space-3` padding.
- The consumer provides the header and the body content. Keep output summarized and let people expand it.

Hand-written from `src/index.css` (`.droid-tool-panel`), with the border removed.
