// browser_wait, checked in main against what the agent reads: text as
// browser_find matches it, a ref, or the address. The page is checked again
// as soon as its document changes, and every half second for what that
// cannot show (cross-site frames, the address).

const { callPageScript } = require('./browserPageScript.cjs');

const MAX_WAIT_MS = 15_000;
const RECHECK_MS = 500;
// A page that never stops changing is still read at most four times a second.
const MIN_GAP_MS = 250;

function createBrowserWait({ reading }) {
  async function wait(contents, entry, request) {
    const waitMs = Math.min(MAX_WAIT_MS, Math.max(0, Number(request.waitMs ?? 5_000) || 0));
    // Counted from when the request arrived, however long the page took to wake.
    const deadline = (request.receivedAt ?? Date.now()) + waitMs;
    if (!request.text && !request.textGone && !request.ref && !request.urlIncludes)
      return delay(Math.max(0, deadline - Date.now()));
    for (;;) {
      const unmet = await unmetCondition(contents, entry, request);
      if (!unmet) return;
      const left = deadline - Date.now();
      if (left <= 0) throw new Error(`Still waiting after ${seconds(waitMs)}: ${unmet}.`);
      const gap = delay(Math.min(MIN_GAP_MS, left));
      const recheck = Math.min(RECHECK_MS, left);
      await Promise.race([
        callPageScript(contents, '__droidexNextChange', recheck).catch(() => undefined),
        delay(recheck),
      ]);
      await gap;
    }
  }

  // What still does not hold, said the way the agent asked for it.
  async function unmetCondition(contents, entry, request) {
    if (request.urlIncludes && !contents.getURL().includes(request.urlIncludes))
      return `the address does not have "${request.urlIncludes}"`;
    if (request.text && (await reading.find(contents, entry, request.text)).matches === 0)
      return `"${request.text}" is not on the page`;
    if (request.textGone) {
      // A page too large to search to the end has not shown the text is gone.
      const found = await reading.find(contents, entry, request.textGone);
      if (found.matches > 0 || !found.complete)
        return `"${request.textGone}" is still on the page, or the page is too large to tell`;
    }
    if (request.ref) {
      const there = await reading
        .readPage(contents, entry, { ref: request.ref, maxChars: 500 })
        .then(
          () => true,
          () => false,
        );
      if (!there) return `${request.ref} is not on the page`;
    }
    return undefined;
  }

  return { wait };
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)} s`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = { createBrowserWait };
