const debuggerOperations = new WeakMap();
const debuggerHolds = new WeakMap();
const ownedAttachments = new WeakSet();
// An operation stops holding the debugger once main has given up on the work
// it belongs to (the sidecar's timeout and a margin), so a stalled command
// never blocks the page for good.
const MAX_HOLD_MS = 15_000;

function detachDebugger(contents) {
  if (debuggerHolds.has(contents)) return;
  if (!ownedAttachments.delete(contents) || contents.isDestroyed()) return;
  if (contents.debugger.isAttached()) contents.debugger.detach();
}

// Detaching clears device emulation and stops screencasts. Their owners hold
// the attachment only for as long as those features are active.
function holdWebContentsDebugger(contents) {
  debuggerHolds.set(contents, (debuggerHolds.get(contents) ?? 0) + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = debuggerHolds.get(contents) - 1;
    if (remaining) debuggerHolds.set(contents, remaining);
    else debuggerHolds.delete(contents);
    if (!debuggerOperations.has(contents)) detachDebugger(contents);
  };
}

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
    if (!dbg.isAttached()) {
      dbg.attach('1.3');
      ownedAttachments.add(contents);
    }
    try {
      return await operation(dbg, () => !released);
    } finally {
      // A timed-out operation must never detach a later operation's debugger.
      if (!released) {
        released = true;
        detachDebugger(contents);
      }
    }
  });
  let timer;
  const held = previous
    .then(() =>
      Promise.race([
        current.catch(() => undefined),
        new Promise((resolve) => {
          timer = setTimeout(() => {
            released = true;
            detachDebugger(contents);
            resolve();
          }, MAX_HOLD_MS);
        }),
      ]),
    )
    .finally(() => clearTimeout(timer));
  debuggerOperations.set(contents, held);
  void held.then(() => {
    if (debuggerOperations.get(contents) === held) {
      debuggerOperations.delete(contents);
      detachDebugger(contents);
    }
  });
  return current;
}

module.exports = { runWithWebContentsDebugger, holdWebContentsDebugger };
