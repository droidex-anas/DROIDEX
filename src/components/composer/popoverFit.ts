const WINDOW_MARGIN_PX = 12;

// A composer popover opens from its trigger's left edge and grows right. On a
// cramped window that edge leaves too little room, so the panel narrows to what
// is left and then slides back from the window edge, rather than putting a row
// out of reach. Measure from the trigger, not the panel, so one already slid
// left does not feed its own offset back in.
export function fitToWindow(
  anchorLeft: number,
  windowWidth: number,
  preferredWidth: number,
  minWidth: number,
): { width: number; left: number } {
  const room = windowWidth - anchorLeft - WINDOW_MARGIN_PX;
  const width = Math.min(preferredWidth, Math.max(minWidth, room));
  return { width, left: Math.min(0, room - width) };
}
