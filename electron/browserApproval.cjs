// An approval belongs to one document and one live request. Its prompt is
// dismissed on navigation, closure or expiry, even if the renderer never answers.
function browserApproval(contents, entry, request) {
  const documents = entry.documents;
  const url = contents.getURL();
  const controller = new AbortController();
  const abort = () => controller.abort();
  const onNavigation = (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) abort();
  };
  contents.on('did-start-navigation', onNavigation);
  contents.on('destroyed', abort);
  request.signal.addEventListener('abort', abort, { once: true });
  if (request.signal.aborted) abort();
  const timer = setTimeout(abort, Math.max(0, request.startBy - Date.now()));

  function assertCurrent() {
    if (controller.signal.aborted || Date.now() >= request.startBy || request.runEnded()) {
      throw new Error('The browser request ended before the action completed.');
    }
    if (
      entry.contents !== contents ||
      contents.isDestroyed() ||
      entry.documents !== documents ||
      contents.getURL() !== url
    ) {
      throw new Error('The page changed before the action completed.');
    }
  }

  function dispose() {
    abort();
    clearTimeout(timer);
    contents.removeListener('did-start-navigation', onNavigation);
    contents.removeListener('destroyed', abort);
    request.signal.removeEventListener('abort', abort);
  }

  return { assertCurrent, signal: controller.signal, dispose };
}

module.exports = { browserApproval };
