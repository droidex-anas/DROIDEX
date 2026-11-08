// A prompt sent with canvas frames or elements pinned to it: the user's words,
// then the frames and the elements named in tagged blocks (built by the
// renderer's promptWithCanvasPins). The model reads the whole prompt; replay
// splits the blocks back out, so the bubble shows the frames as chips beside
// what the user typed. Picked elements have no chip there, so only their block goes.
const FRAMES_OPEN =
  '<canvas_frames>\nThe user pinned these canvas frames to this request; "this" and "it" mean them.';
const FRAMES_CLOSE = '</canvas_frames>';
const ELEMENTS_OPEN =
  '<canvas_elements>\nThe user picked these elements for this request; change them, not the rest of their designs.';
const ELEMENTS_CLOSE = '</canvas_elements>';
const FRAME = /<frame id="[^"\n]*">([^\n]*?)<\/frame>/g;

export function canvasPinsFromPrompt(
  text: string,
): { text: string; canvasFrames?: string[] } | null {
  const elementsStart = blockStart(text, ELEMENTS_OPEN, ELEMENTS_CLOSE);
  const words = elementsStart === null ? text : text.slice(0, elementsStart).trimEnd();
  const framesStart = blockStart(words, FRAMES_OPEN, FRAMES_CLOSE);
  if (framesStart !== null) {
    const block = words.slice(framesStart + FRAMES_OPEN.length, -FRAMES_CLOSE.length);
    const canvasFrames = [...block.matchAll(FRAME)].map((match) => match[1]);
    if (canvasFrames.length > 0)
      return { text: words.slice(0, framesStart).trimEnd(), canvasFrames };
  }
  return elementsStart === null ? null : { text: words };
}

/** Where the block `text` ends with starts, or null when it ends with none. */
function blockStart(text: string, open: string, close: string): number | null {
  if (!text.endsWith(close)) return null;
  const start = text.lastIndexOf(open);
  return start < 0 ? null : start;
}
