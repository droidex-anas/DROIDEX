// The one-time "what's new" spotlight for Projects, per profile. It floats to
// the right of the sidebar's Projects entry with a caret pointing back at it.

/** The spotlight's id among the sidebar's one-time announcements. */
export const PROJECTS_INTRO_CARD_ID = 'projects-beta';

export const INTRO_WIDTH = 300;
const INTRO_GAP = 14;
// Tall enough for the card at its longest, so it is kept on screen.
const INTRO_HEIGHT = 330;

export function projectsIntroPosition(
  anchor: { top: number; right: number; height: number },
  viewportHeight: number,
): { top: number; left: number; caretTop: number } {
  const left = anchor.right + INTRO_GAP;
  const top = Math.min(Math.max(12, anchor.top - 14), Math.max(12, viewportHeight - INTRO_HEIGHT));
  const caretTop = Math.max(14, anchor.top + anchor.height / 2 - top - 5);
  return { top, left, caretTop };
}
