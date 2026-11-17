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
  // The compiler gives each JSX usage an outline row is written at the row's
  // id as this prop, a component's usage too.
  const LAYER = 'data-droidex-layer';
  // The elements a layer drew: the outermost ones under each React fiber whose
  // props carry its id. A component's usage draws no element of its own, so
  // its props are read from React's tree rather than the page. Null where no
  // fiber carries the id, or the page has no React root to read.
  const drawnBy = (nodeId) => {
    const container = Object.keys(root).find((name) => /^__reactContainer\\$/.test(name));
    const current = container ? root[container]?.stateNode?.current : null;
    if (!current) return null;
    const drawn = [];
    let found = false;
    const pending = [{ fiber: current, owned: false }];
    while (pending.length > 0) {
      const { fiber, owned } = pending.pop();
      const props = fiber.memoizedProps;
      const mine = owned || (props !== null && typeof props === 'object' && props[LAYER] === nodeId);
      found = found || mine;
      if (mine && fiber.stateNode instanceof Element) {
        drawn.push(fiber.stateNode);
        continue;
      }
      for (let child = fiber.child; child; child = child.sibling) pending.push({ fiber: child, owned: mine });
    }
    return found ? drawn : null;
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
  // Whether the frame shows what a layer drew: each element with a box shows
  // all of it, to the pixel, and where it takes the pointer, nothing covers
  // its middle. The answer is the box around them, false where one does not
  // show or none has a box, and null where the layer is not drawn at all.
  const shownLayer = (nodeId) => {
    const drawn = drawnBy(nodeId);
    if (drawn === null) return null;
    let shown = null;
    for (const element of drawn) {
      const box = element.getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) continue;
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
