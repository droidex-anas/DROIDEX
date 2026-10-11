# Alignment

The ruler test as a live example: every side panel, menu and list uses the same vertical lines.

- **8px** gutter: hover and selected fills start here.
- **20px** content edge: section headers, icons, dividers, plain text, and the boxes of filled buttons ("Connect GitHub") all start here. Trailing meta ends 20px from the right edge.
- **46px** label edge: every row label starts here, including a row with no icon ("Untitled session"), which keeps an empty icon slot.
- A ghost row ("New session") aligns its icon and text, not its hover box, with the lines above it.
- The dashed blue guides are annotation only. They're not part of the UI.
