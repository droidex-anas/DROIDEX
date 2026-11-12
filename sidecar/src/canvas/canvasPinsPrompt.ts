// A prompt sent with canvas pins: the user's words, then the kit components
// tagged, the frames pinned and the elements picked, each named in a tagged
// block (built by the renderer's promptWithCanvasPins). The model reads the
// whole prompt; replay splits the blocks back out, so the bubble shows the
// components and frames as chips beside what the user typed. Picked elements
// have no chip there, so only their block goes.
const COMPONENTS_OPEN =
  '<canvas_components>\nThe user tagged these kit components for this request; read each with canvas_theme catalog, its ref-id, ref-version and ref-mode as ref, and write its jsx and imports as given.';
const COMPONENTS_CLOSE = '</canvas_components>';
const FRAMES_OPEN =
  '<canvas_frames>\nThe user pinned these canvas frames to this request; "this" and "it" mean them.';
const FRAMES_CLOSE = '</canvas_frames>';
const ELEMENTS_OPEN =
  '<canvas_elements>\nThe user picked these elements for this request; change them, not the rest of their designs.';
const ELEMENTS_CLOSE = '</canvas_elements>';
const COMPONENT = /<component kit="([^"\n]*)" ref-id="([^"\n]*)"[^>\n]*>([^\n]*?)<\/component>/g;
const FRAME = /<frame id="[^"\n]*">([^\n]*?)<\/frame>/g;
const ELEMENT = /^<element id="[^"\n]*"[^\n]*<\/element>$/m;

export function canvasPinsFromPrompt(
  text: string,
): { text: string; canvasFrames?: string[]; canvasComponents?: string[] } | null {
  const elementsStart = picksStart(text);
  let words = elementsStart === null ? text : text.slice(0, elementsStart).trimEnd();
  const frames = trailingBlock(words, FRAMES_OPEN, FRAMES_CLOSE, FRAME);
  if (frames) words = frames.before;
  const components = trailingBlock(words, COMPONENTS_OPEN, COMPONENTS_CLOSE, COMPONENT);
  if (components) words = components.before;
  if (!frames && !components && elementsStart === null) return null;
  return {
    text: words,
    ...(frames ? { canvasFrames: frames.records.map(([, name]) => unescapeText(name)) } : {}),
    ...(components ? { canvasComponents: componentLabels(components.records) } : {}),
  };
}

/**
 * What the composer's chips called the components: each entry's name, and its
 * kit's beside it once they come from more than one kit, by the renderer's
 * componentLabels.
 */
function componentLabels(records: readonly RegExpMatchArray[]): string[] {
  const kits = new Set(records.map(([, , kitId]) => kitId));
  return records.map(([, kit, , name]) => {
    const entry = unescapeText(name);
    return kits.size > 1 ? `${entry} · ${unescapeText(kit.replaceAll('&quot;', '"'))}` : entry;
  });
}

/** Where the elements block `text` ends with starts, when it holds at least one pick. */
function picksStart(text: string): number | null {
  const start = blockStart(text, ELEMENTS_OPEN, ELEMENTS_CLOSE);
  return start !== null && ELEMENT.test(text.slice(start)) ? start : null;
}

/** The block `text` ends with and the words before it, when it holds at least one record. */
function trailingBlock(
  text: string,
  open: string,
  close: string,
  record: RegExp,
): { before: string; records: RegExpMatchArray[] } | null {
  const start = blockStart(text, open, close);
  if (start === null) return null;
  const records = [...text.slice(start + open.length, -close.length).matchAll(record)];
  return records.length > 0 ? { before: text.slice(0, start).trimEnd(), records } : null;
}

/** The renderer escapes names so a name cannot close its record. */
function unescapeText(text: string): string {
  return text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
}

/** Where the block `text` ends with starts, or null when it ends with none. */
function blockStart(text: string, open: string, close: string): number | null {
  if (!text.endsWith(close)) return null;
  const start = text.lastIndexOf(open);
  return start < 0 ? null : start;
}
