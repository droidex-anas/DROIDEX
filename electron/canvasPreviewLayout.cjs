// The generated frame's answers about which elements it draws and whether a
// run of them shows, kept as source text: LAYOUT_REPORTER goes into
// GENERATED_FRAME_REPORTER and LAYOUT_INTERMEDIATE into the intermediate's
// script, whose scope gives it `instance`, `askFrame` and `rectOf` and which
// reads its `MAX_ELEMENTS_EVENT_BYTES` to cap an `elements` event. Both only
// read the design's document; neither changes it.
//
// Kept free of `require('electron')` so it runs under plain Node.

/** Elements one `elements` answer may key; past it the answer says it is over. */
const MAX_PREVIEW_ELEMENT_KEYS = 2000;
/** A key is at most 7 base-36 digits; with quotes and commas each takes 10 bytes. */
const MAX_PREVIEW_ELEMENTS_EVENT_BYTES = MAX_PREVIEW_ELEMENT_KEYS * 10 + 1024;
/** Both answers walk every element the page draws, so they get longer than a probe. */
const PREVIEW_LAYOUT_DEADLINE_MS = 2_000;

const LAYOUT_REPORTER = `
  const drawnElements = () => Array.from(document.body.querySelectorAll('*'));
  // Each element's depth, tag and class, hashed (FNV-1a), so two renders of
  // the same source give the same keys and an added run shows as keys the
  // earlier render lacks. Text stays out: it changes without adding elements.
  const elementKeys = () => {
    const drawn = drawnElements();
    if (drawn.length > ${String(MAX_PREVIEW_ELEMENT_KEYS)}) return { over: true };
    const holders = [];
    const keys = drawn.map((element) => {
      while (holders.length > 0 && !holders[holders.length - 1].contains(element)) holders.pop();
      holders.push(element);
      const said = holders.length + ' ' + element.localName + ' ' + (element.getAttribute('class') || '');
      let hash = 0x811c9dc5;
      for (let index = 0; index < said.length; index += 1) {
        hash ^= said.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
      }
      return (hash >>> 0).toString(36);
    });
    return { keys: keys };
  };
  // The part of a box the frame shows: inside its viewport and every element
  // that clips what overflows it.
  const shownPart = (element, box) => {
    let left = Math.max(box.left, 0);
    let top = Math.max(box.top, 0);
    let right = Math.min(box.right, innerWidth);
    let bottom = Math.min(box.bottom, innerHeight);
    for (let at = element.parentElement; at && at !== document.body; at = at.parentElement) {
      const style = getComputedStyle(at);
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
      const clip = at.getBoundingClientRect();
      left = Math.max(left, clip.left + at.clientLeft);
      top = Math.max(top, clip.top + at.clientTop);
      right = Math.min(right, clip.left + at.clientLeft + at.clientWidth);
      bottom = Math.min(bottom, clip.top + at.clientTop + at.clientHeight);
    }
    return { left: left, top: top, right: Math.max(left, right), bottom: Math.max(top, bottom) };
  };
  // Whether a run of the drawn elements shows: each outermost one with a box
  // shows all of it, to the pixel, and where it takes the pointer, nothing
  // covers its middle. The answer is the box around them.
  const shownRun = (from, count) => {
    const outermost = [];
    for (const element of drawnElements().slice(from, from + count)) {
      if (outermost.some((outer) => outer.contains(element))) continue;
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) outermost.push(element);
    }
    if (outermost.length === 0) return false;
    let shown = null;
    for (const element of outermost) {
      const box = element.getBoundingClientRect();
      const part = shownPart(element, box);
      if (part.right - part.left < box.width - 1 || part.bottom - part.top < box.height - 1) return false;
      const middle = document.elementFromPoint((part.left + part.right) / 2, (part.top + part.bottom) / 2);
      if (getComputedStyle(element).pointerEvents !== 'none' && !element.contains(middle)) return false;
      shown = shown
        ? {
            left: Math.min(shown.left, part.left),
            top: Math.min(shown.top, part.top),
            right: Math.max(shown.right, part.right),
            bottom: Math.max(shown.bottom, part.bottom),
          }
        : part;
    }
    return { x: shown.left, y: shown.top, width: shown.right - shown.left, height: shown.bottom - shown.top };
  };
`;

const LAYOUT_INTERMEDIATE = `
  const MAX_ELEMENTS_EVENT_BYTES = ${String(MAX_PREVIEW_ELEMENTS_EVENT_BYTES)};
  const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
  const normalizeKeys = (data) => {
    const answer = data.elements;
    if (!answer || typeof answer !== 'object') return null;
    if (answer.over === true) return { over: true };
    const given = answer.keys;
    if (!Array.isArray(given) || given.length > ${String(MAX_PREVIEW_ELEMENT_KEYS)}) return null;
    if (!given.every((key) => typeof key === 'string' && /^[0-9a-z]{1,7}$/.test(key))) return null;
    return { keys: given };
  };
  const askElements = () => {
    if (!instance) throw new Error('This Canvas preview guest was never started.');
    return askFrame({ command: 'elements' }, normalizeKeys, ${String(PREVIEW_LAYOUT_DEADLINE_MS)});
  };
  const askShown = (request) => {
    if (!instance) throw new Error('This Canvas preview guest was never started.');
    if (!request || !isCount(request.from) || !isCount(request.count)) return 'invalid_request';
    const command = { command: 'shown', from: request.from, count: request.count };
    const read = (data) => (data.shown === false ? false : rectOf(data.shown));
    return askFrame(command, read, ${String(PREVIEW_LAYOUT_DEADLINE_MS)});
  };
`;

module.exports = { LAYOUT_INTERMEDIATE, LAYOUT_REPORTER };
