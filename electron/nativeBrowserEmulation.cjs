const debuggerOperations = new WeakMap();
// An operation stops holding the debugger once main has given up on the work
// it belongs to (the sidecar's timeout and a margin), so a stalled command
// never blocks the page for good.
const MAX_HOLD_MS = 15_000;

// One operation on a page's debugger at a time, in the order they came. An
// operation is also given `holding()`, false once the queue has moved on
// without it: one that sends input checks it first, so a command that answers
// late cannot let its gesture land among the next operation's.
function runWithWebContentsDebugger(contents, operation) {
  if (!contents || contents.isDestroyed()) return Promise.resolve(undefined);
  const previous = debuggerOperations.get(contents) ?? Promise.resolve();
  let released = false;
  const current = previous.then(async () => {
    if (contents.isDestroyed()) return undefined;
    const dbg = contents.debugger;
    if (!dbg) throw new Error('Chromium debugger is unavailable.');
    if (!dbg.isAttached()) dbg.attach('1.3');
    return operation(dbg, () => !released);
  });
  let timer;
  const held = previous
    .then(() =>
      Promise.race([
        current.catch(() => undefined),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            released = true;
            resolve();
          }, MAX_HOLD_MS);
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
