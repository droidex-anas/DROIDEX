# Card

A floating, rounded surface for the right panel, the sidebar when it floats, and any block that should lift off the canvas.

- `surface` fill, `radius-xl`, overflow clipped. Tone separates the card from `bg`; add `shadow-lg` when floating. No outline or state ring.
- Pad the content with `space-4`. Put a `subheading` title first, then `body` text in `text-secondary`, then actions `space-4` below.
- Don't nest cards. Inside a card, group things with space or `elevated` fills, never lines under headers or around groups.
- The consumer provides the content and its padding. The card brings only the surface.

Hand-written from `src/index.css` (`.droid-card`), with the border removed.
