function createBrowserActionResult({ runWithWebContentsDebugger, redactUrl }) {
  // The page after an action, with what the agent reads about it: what
  // changed besides the action itself, then the [Title · url] footer.
  async function result(request, contents, entry, since, urlBefore = contents.getURL()) {
    const snapshot = await pageSnapshot(contents);
    const notes = [];
    if (snapshot.url !== urlBefore) notes.push('The page went to a new address.');
    const errors = entry.errorTimes.filter((at) => at >= since).length;
    if (errors)
      notes.push(
        `${errors} new console error${errors === 1 ? '' : 's'}; browser_console has them.`,
      );
    notes.push(`[${snapshot.title || 'Untitled'} · ${redactUrl(snapshot.url)}]`);
    return { requestId: request.requestId, ok: true, snapshot, text: notes.join('\n') };
  }

  // Where the page is, read by main rather than asked of the page.
  async function pageSnapshot(contents) {
    if (contents.isDestroyed()) throw new Error('The browser page closed.');
    const metrics = await runWithWebContentsDebugger(contents, (dbg) =>
      dbg.sendCommand('Page.getLayoutMetrics'),
    ).catch(() => undefined);
    const view = metrics?.cssVisualViewport;
    const history = contents.navigationHistory;
    return {
      url: contents.getURL(),
      title: contents.getTitle(),
      scroll: { x: Math.round(view?.pageX ?? 0), y: Math.round(view?.pageY ?? 0) },
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
    };
  }

  return result;
}

module.exports = { createBrowserActionResult };
