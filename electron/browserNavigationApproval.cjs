const { exactHttpOrigin } = require('./browserSettingsSchema.cjs');
const { createBrowserNavigationProvenance } = require('./browserNavigationProvenance.cjs');

function createBrowserNavigationApproval({ authorizeAgentOrigin, loadUrl, reportFailure }) {
  const provenance = createBrowserNavigationProvenance();
  const bindings = new WeakMap();
  const requests = new Map(); // Chromium request id, including its redirect hops

  function bind(entry, contents) {
    const binding = {
      entry,
      contents,
      pending: new Map(),
      operations: new Map(),
      failures: new Map(),
    };
    bindings.set(contents, binding);
    contents.on('before-input-event', (_event, input) => {
      if (isCurrent(binding)) provenance.physicalInput(entry, contents, input);
    });
    contents.on('before-mouse-event', (_event, input) => {
      if (isCurrent(binding)) provenance.physicalInput(entry, contents, input);
    });
    // Non-network schemes never reach the HTTP request gate.
    contents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame || !isCurrent(binding)) return;
      if (/^https?:/i.test(event.url)) return;
      const context = provenance.consume(entry, contents, event.url);
      if (context.initiator === 'user') return;
      event.preventDefault();
      fail(
        binding,
        event.url,
        new Error('Agent browser URLs must use http(s) without embedded credentials.'),
        context,
      );
    });
    contents.on('will-redirect', (event, url, _inPlace, isMainFrame) => {
      if (!isMainFrame || !isCurrent(binding) || /^https?:/i.test(url)) return;
      const context = binding.transition?.context;
      if (context?.initiator === 'user') return;
      event.preventDefault();
      fail(
        binding,
        url,
        new Error('Agent browser URLs must use http(s) without embedded credentials.'),
        context,
      );
    });
    contents.setWindowOpenHandler(({ url, referrer, postBody }) => {
      if (isCurrent(binding)) {
        const context = provenance.consume(entry, contents, url);
        track(binding, context, popup(binding, url, context, referrer, postBody)).catch((error) =>
          fail(binding, url, error, context),
        );
      }
      return { action: 'deny' };
    });
    contents.on('did-navigate', () => cancelPending(contents));
    contents.on('render-process-gone', () => cancelPending(contents));
    contents.once('destroyed', () => invalidate(contents));
  }

  function isCurrent({ entry, contents }) {
    return entry.contents === contents && !contents.isDestroyed();
  }

  function check(context) {
    const request = context.request;
    if (request && (Date.now() >= request.startBy || request.runEnded?.()))
      throw new Error('The browser page did not finish in time.');
  }

  async function authorize(binding, url, context, sameOrigin) {
    if (context.initiator === 'user') return;
    exactHttpOrigin(url);
    check(context);
    if (sameOrigin) return;
    const pending = new AbortController();
    binding.pending.set(pending, binding.contents.getURL());
    const document = binding.entry.documents;
    const expiresAt = context.request?.startBy;
    const timer = Number.isFinite(expiresAt)
      ? setTimeout(
          () => pending.abort(new Error('The browser page did not finish in time.')),
          Math.max(0, expiresAt - Date.now()),
        )
      : undefined;
    binding.contents.emit('droidex-navigation-approval-start', pending);
    try {
      await authorizeAgentOrigin(url, context.autonomy, pending.signal);
      pending.signal.throwIfAborted();
      if (!isCurrent(binding) || binding.entry.documents !== document)
        throw new Error('Browser navigation was canceled because the browser page changed.');
      check(context);
    } finally {
      clearTimeout(timer);
      binding.pending.delete(pending);
      binding.contents.emit('droidex-navigation-approval-end', pending);
    }
  }

  // Pausing the original request preserves a form's POST body and headers.
  // Replaying a canceled navigation with loadURL would silently turn it into GET.
  function beforeRequest(details, callback, entry) {
    if (details.resourceType !== 'mainFrame') return callback({});
    const contents = entry?.contents;
    const binding = contents && bindings.get(contents);
    if (!binding || !isCurrent(binding)) return callback({ cancel: true });
    let navigation = requests.get(details.id);
    if (!navigation) {
      navigation = {
        binding,
        context: provenance.consume(entry, contents, details.url),
        origin: originOf(contents.getURL()),
        document: entry.documents,
      };
      requests.set(details.id, navigation);
      binding.transition = navigation;
    }
    if (navigation.binding !== binding) return callback({ cancel: true });
    const sameOrigin =
      navigation.context.approvedUrl === details.url || navigation.origin === originOf(details.url);
    navigation.context.approvedUrl = null;
    void track(
      binding,
      navigation.context,
      authorize(binding, details.url, navigation.context, sameOrigin),
    ).then(
      () => {
        if (!isCurrent(binding) || entry.documents !== navigation.document)
          return callback({ cancel: true });
        navigation.origin = originOf(details.url);
        navigation.url = details.url;
        callback({});
      },
      (error) => {
        requests.delete(details.id);
        fail(binding, details.url, error, navigation.context);
        callback({ cancel: true });
      },
    );
  }

  async function popup(binding, url, context, referrer, postBody) {
    await authorize(binding, url, context, originOf(binding.contents.getURL()) === originOf(url));
    if (!isCurrent(binding)) return;
    binding.preparedLoad = {
      url,
      request: {
        ...context.request,
        initiator: context.initiator,
        autonomy: context.autonomy,
        approvedUrl: url,
      },
    };
    const contentType =
      postBody &&
      (postBody.boundary
        ? `${postBody.contentType}; boundary=${postBody.boundary}`
        : postBody.contentType);
    await loadUrl(binding.entry, url, {
      force: true,
      httpReferrer: referrer,
      postData: postBody?.data,
      extraHeaders: contentType ? `Content-Type: ${contentType}\r\n` : undefined,
    });
  }

  async function open(entry, contents, url, request) {
    const binding = bindings.get(contents);
    if (!binding || !isCurrent(binding)) throw new Error('The browser page closed.');
    await authorize(binding, url, { ...request, request }, false);
    if (!isCurrent(binding)) throw new Error('The browser page closed.');
    // The direct target has already been approved; redirects keep the initiator.
    binding.preparedLoad = { url, request: { ...request, approvedUrl: url } };
  }

  function recordLoad(entry, contents, url) {
    const binding = bindings.get(contents);
    const prepared = binding.preparedLoad;
    binding.preparedLoad = null;
    provenance.record(
      entry,
      contents,
      prepared?.url === url ? prepared.request : { initiator: 'user' },
      url,
    );
  }

  async function retry(entry, url, failedUrl) {
    const binding = bindings.get(entry.contents);
    if (!binding || !isCurrent(binding)) throw new Error('The browser page closed.');
    const transition = binding.transition;
    const context =
      transition?.url === failedUrl
        ? transition.context
        : provenance.consume(entry, entry.contents, failedUrl);
    await authorize(binding, url, context, false);
    if (!isCurrent(binding)) throw new Error('The browser page closed.');
    binding.preparedLoad = {
      url,
      request: {
        ...context.request,
        initiator: context.initiator,
        autonomy: context.autonomy,
        approvedUrl: url,
      },
    };
    return loadUrl(entry, url, { force: true });
  }

  function track(binding, context, promise) {
    const requestId = context.request?.requestId;
    binding.operations.set(promise, requestId);
    void promise.finally(() => binding.operations.delete(promise)).catch(() => undefined);
    return promise;
  }

  async function waitForApprovals(contents, requestId) {
    const binding = bindings.get(contents);
    if (!binding) return;
    const operations = [...binding.operations].filter(([, owner]) => owner === requestId);
    await Promise.allSettled(operations.map(([promise]) => promise));
    takeFailure(contents, requestId);
  }

  function fail(binding, url, error, context) {
    if (!isCurrent(binding)) return;
    if (context?.request?.requestId) binding.failures.set(context.request.requestId, error);
    if (binding.entry.targetUrl === url) binding.entry.targetUrl = binding.contents.getURL();
    binding.contents.emit('droidex-navigation-denied');
    reportFailure(binding.entry, url, error.message);
  }

  function takeFailure(contents, requestId) {
    const binding = bindings.get(contents);
    const failure = binding?.failures.get(requestId);
    binding?.failures.delete(requestId);
    if (failure) throw failure;
  }

  function cancelPending(contents) {
    const binding = bindings.get(contents);
    if (!binding) return;
    for (const pending of binding.pending.keys())
      pending.abort(new Error('The browser page closed.'));
  }

  function invalidate(contents) {
    const binding = bindings.get(contents);
    if (!binding) return;
    if (binding.pending.size > 0) binding.entry.targetUrl = binding.pending.values().next().value;
    bindings.delete(contents);
    provenance.forget(contents);
    for (const pending of binding.pending.keys())
      pending.abort(new Error('The browser page closed.'));
    for (const [id, navigation] of requests) {
      if (navigation.binding === binding) requests.delete(id);
    }
  }

  return {
    bind,
    beforeRequest,
    open,
    recordLoad,
    retry,
    takeFailure,
    waitForApprovals,
    invalidate,
    cancelPending,
    dispatch: provenance.dispatch,
    recordAction: (entry, contents, request) => provenance.record(entry, contents, request),
    complete: (id) => requests.delete(id),
  };
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

module.exports = { createBrowserNavigationApproval };
