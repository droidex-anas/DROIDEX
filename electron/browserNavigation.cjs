// Whether an agent action led to a new document: a main-frame navigation that
// replaces the page (hash and History changes keep it), and when it ends.

const NAVIGATION_WAIT_MS = 7_000;
// How long after an input or a script a navigation it caused may take to start.
const NAVIGATION_GRACE_MS = 150;

function observeNavigation(contents) {
  let started = false;
  let settled = false;
  let timeout;
  let resolveCompletion;
  let resolveStart;
  const completion = new Promise((resolve) => {
    resolveCompletion = resolve;
  });
  const start = new Promise((resolve) => {
    resolveStart = resolve;
  });
  const finish = () => {
    if (settled) return;
    settled = true;
    resolveCompletion();
  };
  // Only a new document counts: hash and History changes keep the page.
  const onStart = (_event, _url, isInPlace, isMainFrame) => {
    if (!isMainFrame || isInPlace || started) return;
    started = true;
    resolveStart();
    timeout = setTimeout(finish, NAVIGATION_WAIT_MS);
  };
  const onFinish = () => {
    if (started) finish();
  };
  const onFail = (_event, errorCode, _description, _url, isMainFrame) => {
    if (started && isMainFrame && errorCode !== -3) finish();
  };
  contents.on('did-start-navigation', onStart);
  contents.on('did-finish-load', onFinish);
  contents.on('did-fail-load', onFail);
  contents.on('destroyed', finish);
  return {
    started: () => started,
    wait: () => completion,
    startsWithin: (ms) => {
      let timer;
      return Promise.race([
        start,
        new Promise((resolve) => {
          timer = setTimeout(resolve, ms);
        }),
      ]).finally(() => clearTimeout(timer));
    },
    dispose: () => {
      clearTimeout(timeout);
      contents.removeListener('did-start-navigation', onStart);
      contents.removeListener('did-finish-load', onFinish);
      contents.removeListener('did-fail-load', onFail);
      contents.removeListener('destroyed', finish);
    },
  };
}

function isNavigationError(error) {
  const message = String(error?.message || error).toLowerCase();
  return [
    'script execution was interrupted',
    'execution context was destroyed',
    'frame was disposed',
    'object has been destroyed',
    'cannot find context',
  ].some((part) => message.includes(part));
}

module.exports = { observeNavigation, isNavigationError, NAVIGATION_GRACE_MS };
