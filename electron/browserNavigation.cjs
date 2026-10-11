// Whether an agent action led to a new document: a main-frame navigation that
// replaces the page (hash and History changes keep it), and when it ends.

const NAVIGATION_WAIT_MS = 7_000;
// How long after an input or a script a navigation it caused may take to start.
const NAVIGATION_GRACE_MS = 150;

function observeNavigation(contents) {
  let started = false;
  let settled = false;
  let timeout;
  const approvals = new Set();
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
    if (approvals.size === 0) timeout = setTimeout(finish, NAVIGATION_WAIT_MS);
  };
  const onFinish = () => {
    if (started) finish();
  };
  const onFail = (_event, errorCode, _description, _url, isMainFrame) => {
    if (started && isMainFrame && errorCode !== -3) finish();
  };
  // A question uses the prompt budget, not the page load timeout.
  const onApprovalStart = (approval) => {
    approvals.add(approval);
    clearTimeout(timeout);
  };
  const onApprovalEnd = (approval) => {
    approvals.delete(approval);
    if (approvals.size === 0 && started && !settled)
      timeout = setTimeout(finish, NAVIGATION_WAIT_MS);
  };
  contents.on('droidex-navigation-approval-start', onApprovalStart);
  contents.on('droidex-navigation-approval-end', onApprovalEnd);
  contents.on('droidex-navigation-denied', onFinish);
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
      contents.removeListener('droidex-navigation-approval-start', onApprovalStart);
      contents.removeListener('droidex-navigation-approval-end', onApprovalEnd);
      contents.removeListener('droidex-navigation-denied', onFinish);
      contents.removeListener('did-start-navigation', onStart);
      contents.removeListener('did-finish-load', onFinish);
      contents.removeListener('did-fail-load', onFail);
      contents.removeListener('destroyed', finish);
    },
  };
}

module.exports = { observeNavigation, NAVIGATION_GRACE_MS };
