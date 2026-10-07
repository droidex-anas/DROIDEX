const crypto = require('node:crypto');

const DEFAULT_PROMPT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_QUEUED_PROMPTS = 32;

function createBrowserPromptController(options) {
  const queue = [];
  let active = null;
  let rendererReady = false;
  const now = options.now ?? Date.now;
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_PROMPT_TIMEOUT_MS);
  const maxQueuedPrompts = nonNegativeInteger(options.maxQueuedPrompts, DEFAULT_MAX_QUEUED_PROMPTS);

  function request(input, requestOptions = {}) {
    const prompt = validatePrompt(input);
    if (requestOptions.signal?.aborted)
      return Promise.resolve({ response: prompt.cancelId, cancelled: true });
    // Without a window there is no one to ask, now or later.
    if (!options.isAvailable()) return Promise.resolve({ response: prompt.cancelId, cancelled: true });
    expireQueuedPrompts();
    if ((active || !rendererReady) && queue.length >= maxQueuedPrompts) {
      return Promise.resolve({ response: prompt.cancelId, cancelled: true });
    }
    return new Promise((resolve) => {
      const pending = {
        prompt,
        resolve,
        signal: requestOptions.signal,
        abortListener: null,
        expiresAt: now() + timeoutMs,
      };
      if (pending.signal) {
        pending.abortListener = () => abortPending(pending);
        pending.signal.addEventListener('abort', pending.abortListener, { once: true });
      }
      pending.timeout = (options.setTimeout || setTimeout)(() => abortPending(pending), timeoutMs);
      enqueue(pending);
      showNext();
    });
  }

  // Prompts wait for the renderer's prompt UI to register; their deadline still runs.
  function showNext() {
    if (active || !rendererReady) return;
    while (queue.length > 0) {
      const pending = queue.shift();
      if (now() >= pending.expiresAt || !options.isAvailable()) {
        settleQueued(pending);
        continue;
      }
      const requestId = (options.randomUUID || crypto.randomUUID)();
      pending.requestId = requestId;
      active = pending;
      try {
        options.send({ requestId, ...pending.prompt, expiresAt: pending.expiresAt });
      } catch {
        settle(requestId, pending.prompt.cancelId, true);
      }
      return;
    }
  }

  function enqueue(pending) {
    if (pending.prompt.kind !== 'credential') {
      queue.push(pending);
      return;
    }
    const firstLowerPriority = queue.findIndex(
      (candidate) => candidate.prompt.kind !== 'credential',
    );
    if (firstLowerPriority === -1) queue.push(pending);
    else queue.splice(firstLowerPriority, 0, pending);
  }

  function resolve(requestId, response) {
    if (active?.requestId !== requestId) return false;
    if (!validResponse(active.prompt, response)) return false;
    if (now() >= active.expiresAt) {
      settle(requestId, active.prompt.cancelId, true);
      return false;
    }
    settle(requestId, response);
    return true;
  }

  function settle(requestId, response, dismiss = false) {
    if (!active || active.requestId !== requestId) return;
    const pending = active;
    if (now() >= pending.expiresAt) {
      response = pending.prompt.cancelId;
      dismiss = true;
    }
    active = null;
    (options.clearTimeout || clearTimeout)(pending.timeout);
    removeAbortListener(pending);
    if (dismiss) dismissBestEffort(pending.requestId);
    pending.resolve(dismiss ? { response, cancelled: true } : { response });
    showNext();
  }

  function dismissBestEffort(requestId) {
    try {
      options.dismiss?.(requestId);
    } catch (error) {
      try {
        (options.logError ?? console.error)('Failed to dismiss browser prompt.', error);
      } catch {
        // Prompt settlement must survive a broken diagnostic sink.
      }
    }
  }

  function abortPending(pending) {
    if (active === pending) {
      settle(active.requestId, pending.prompt.cancelId, true);
      return;
    }
    const index = queue.indexOf(pending);
    if (index === -1) return;
    queue.splice(index, 1);
    settleQueued(pending);
  }

  function expireQueuedPrompts() {
    for (const pending of [...queue]) {
      if (now() >= pending.expiresAt) abortPending(pending);
    }
  }

  function settleQueued(pending) {
    (options.clearTimeout || clearTimeout)(pending.timeout);
    removeAbortListener(pending);
    pending.resolve({ response: pending.prompt.cancelId, cancelled: true });
  }

  function cancelAll() {
    if (active) {
      const pending = active;
      active = null;
      (options.clearTimeout || clearTimeout)(pending.timeout);
      removeAbortListener(pending);
      dismissBestEffort(pending.requestId);
      pending.resolve({ response: pending.prompt.cancelId, cancelled: true });
    }
    while (queue.length > 0) {
      const pending = queue.shift();
      settleQueued(pending);
    }
  }

  function setRendererReady(ready) {
    if (typeof ready !== 'boolean') throw new Error('Browser prompt readiness must be a boolean.');
    rendererReady = ready;
    if (ready) showNext();
    else cancelAll();
  }

  return { cancelAll, request, resolve, setRendererReady };
}

function validResponse(prompt, response) {
  return Number.isInteger(response) && response >= 0 && response < prompt.buttons.length;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function removeAbortListener(pending) {
  if (pending.signal && pending.abortListener) {
    pending.signal.removeEventListener('abort', pending.abortListener);
    pending.abortListener = null;
  }
}

function validatePrompt(input) {
  if (!input || typeof input !== 'object') throw new Error('Browser prompt is invalid.');
  const buttons = Array.isArray(input.buttons)
    ? input.buttons.map((button) => boundedText(button, 80))
    : [];
  if (buttons.length < 2 || buttons.length > 4 || buttons.some((button) => !button)) {
    throw new Error('Browser prompt requires two to four labeled actions.');
  }
  const cancelId = input.cancelId;
  if (!Number.isInteger(cancelId) || cancelId < 0 || cancelId >= buttons.length) {
    throw new Error('Browser prompt requires a valid cancel action.');
  }
  const defaultId = input.defaultId ?? cancelId;
  if (!Number.isInteger(defaultId) || defaultId < 0 || defaultId >= buttons.length) {
    throw new Error('Browser prompt requires a valid default action.');
  }
  return {
    kind: ['question', 'warning', 'permission', 'credential'].includes(input.kind)
      ? input.kind
      : 'question',
    title: boundedText(input.title, 120),
    message: boundedText(input.message, 320),
    detail: boundedText(input.detail, 800),
    origin: boundedText(input.origin, 200) || null,
    buttons,
    cancelId,
    defaultId,
  };
}

function boundedText(value, limit) {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

module.exports = { createBrowserPromptController };
