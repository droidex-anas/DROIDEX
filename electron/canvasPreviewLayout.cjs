// The generated frame's answer to whether it shows what one layer drew, kept
// as source text: LAYOUT_REPORTER goes into GENERATED_FRAME_REPORTER, whose
// scope gives it `root`, and LAYOUT_INTERMEDIATE into the intermediate's
// script, whose scope gives it `instance`, `askFrame` and `rectOf`. Both only
// read the design's document; neither changes it.
//
// Kept free of `require('electron')` so it runs under plain Node.

/** The answer walks the page's whole React tree, so it gets longer than a probe. */
const PREVIEW_LAYOUT_DEADLINE_MS = 2_000;

const LAYOUT_REPORTER = `
  // The boxes a layer paints: the outermost boxed elements under each React
  // fiber whose props object the compiler filed under the layer's id when its
  // usage ran. A component's usage draws no element of its own, so its fiber
  // is found in React's tree rather than the page. Under an element with no
  // box, as with \`display: contents\`, the walk goes on through its fibers, so
  // it reaches the portals they render elsewhere in the page too. Null where
  // no fiber is the layer's, or the page has no React root to read.
  const drawnBy = (nodeId) => {
    const layers = globalThis.__droidexLayers;
    const container = Object.keys(root).find((name) => /^__reactContainer\\$/.test(name));
    const current = container ? root[container]?.stateNode?.current : null;
    if (!(layers instanceof WeakMap) || !current) return null;
    const drawn = [];
    let found = false;
    const pending = [{ fiber: current, owned: false }];
    while (pending.length > 0) {
      const { fiber, owned } = pending.pop();
      const mine = owned || layers.get(fiber.memoizedProps) === nodeId;
      found = found || mine;
      const element = fiber.stateNode;
      if (mine && element instanceof Element) {
        if (!fiber.child) {
          drawn.push(...painted(element));
          continue;
        }
        const box = element.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          drawn.push({ element, box });
          continue;
        }
      }
      for (let child = fiber.child; child; child = child.sibling) pending.push({ fiber: child, owned: mine });
    }
    return found ? drawn : null;
  };
  // What an element with no fibers under it paints, as one holding HTML React
  // set: itself where it has a box, else the boxed elements under it.
  const painted = (element) => {
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) return [{ element, box }];
    return [...element.children].flatMap(painted);
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
  // Whether the frame shows what a layer drew: each element it paints shows
  // all of it, to the pixel, and where it takes the pointer, nothing covers
  // its middle. The answer is the box around them, false where one does not
  // show or none paints, and null where the layer is not drawn at all.
  const shownLayer = (nodeId) => {
    const drawn = drawnBy(nodeId);
    if (drawn === null) return null;
    let shown = null;
    for (const { element, box } of drawn) {
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
    if (!shown) return false;
    return { x: shown.left, y: shown.top, width: shown.right - shown.left, height: shown.bottom - shown.top };
  };
`;

const LAYOUT_INTERMEDIATE = `
  const askShown = (request) => {
    if (!instance) throw new Error('This Canvas preview guest was never started.');
    const nodeId = request && typeof request === 'object' ? request.nodeId : null;
    if (typeof nodeId !== 'string' || !/^[0-9a-f]{16}$/.test(nodeId)) return 'invalid_request';
    const read = (data) => (data.shown === false ? false : rectOf(data.shown));
    return askFrame({ command: 'shown', nodeId }, read, ${String(PREVIEW_LAYOUT_DEADLINE_MS)});
  };
`;

module.exports = { LAYOUT_INTERMEDIATE, LAYOUT_REPORTER };
