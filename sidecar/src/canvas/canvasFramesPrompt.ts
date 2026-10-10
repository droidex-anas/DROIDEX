// A prompt sent with canvas frames pinned to it: the user's words, then the
// frames named in a tagged block (built by the renderer's promptWithFramePins).
// The model reads the whole prompt; replay splits the frames back out so the
// bubble shows them as chips beside what the user typed.
const FRAMES_OPEN =
  '<canvas_frames>\nThe user pinned these canvas frames to this request; "this" and "it" mean them.';
const FRAMES_CLOSE = '</canvas_frames>';
const FRAME = /<frame id="[^"\n]*">([^\n]*?)<\/frame>/g;

export function canvasFramesFromPrompt(
  text: string,
): { text: string; canvasFrames: string[] } | null {
  if (!text.endsWith(FRAMES_CLOSE)) return null;
  const start = text.lastIndexOf(FRAMES_OPEN);
  if (start < 0) return null;
  const block = text.slice(start + FRAMES_OPEN.length, -FRAMES_CLOSE.length);
  const canvasFrames = [...block.matchAll(FRAME)].map((match) => match[1]);
  if (canvasFrames.length === 0) return null;
  return { text: text.slice(0, start).trimEnd(), canvasFrames };
}
