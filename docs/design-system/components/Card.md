# Card

A floating, rounded surface for the right panel, the sidebar when it floats, and any block that should lift off the canvas.

- `surface` fill, `radius-xl`, `shadow-lg`, overflow clipped. No border: the faint ring inside `shadow-lg` gives the edge.
- Pad the content with `space-4`. Put a `subheading` title first, then `body` text in `text-secondary`, then actions `space-4` below.
- Don't nest cards. Inside a card, group things with `elevated` fills or a `divider`.
- The consumer provides the content and its padding. The card brings only the surface.

Hand-written from `src/index.css` (`.droid-card`), with the border removed.
