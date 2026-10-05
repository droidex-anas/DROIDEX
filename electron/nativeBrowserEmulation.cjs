const debuggerOperations = new WeakMap();
// An operation stops holding the debugger once main has given up on the work
// it belongs to (the sidecar's timeout and a margin), so a stalled command
// never blocks the page for good.
const MAX_HOLD_MS = 15_000;

// One operation on a page's debugger at a time, in the order they came.
function runWithWebContentsDebugger(contents, operation) {
  if (!contents || contents.isDestroyed()) return Promise.resolve(undefined);
  const previous = debuggerOperations.get(contents) ?? Promise.resolve();
  const current = previous.then(async () => {
    if (contents.isDestroyed()) return undefined;
    const dbg = contents.debugger;
    if (!dbg) throw new Error('Chromium debugger is unavailable.');
    if (!dbg.isAttached()) dbg.attach('1.3');
    return operation(dbg);
  });
  let timer;
  const held = previous
    .then(() =>
      Promise.race([
        current.catch(() => undefined),
        new Promise((resolve) => {
          timer = setTimeout(resolve, MAX_HOLD_MS);
        }),
      ]),
    )
    .finally(() => clearTimeout(timer));
  debuggerOperations.set(contents, held);
  void held.then(() => {
    if (debuggerOperations.get(contents) === held) debuggerOperations.delete(contents);
  });
  return current;
}

module.exports = { runWithWebContentsDebugger };
