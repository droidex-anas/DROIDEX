const ACTIVATION_TTL_MS = 1_000;

function createBrowserNavigationProvenance({ now = Date.now } = {}) {
  const activations = new WeakMap();
  const dispatches = new WeakMap();

  function record(entry, contents, request, destinationUrl) {
    activations.set(contents, {
      initiator: request.initiator === 'user' ? 'user' : 'agent',
      autonomy: request.autonomy ?? 'low',
      request,
      approvedUrl: request.approvedUrl && new URL(request.approvedUrl).href,
      destinationUrl: destinationUrl && new URL(destinationUrl).href,
      document: entry.documents,
      expiresAt: now() + ACTIVATION_TTL_MS,
    });
  }

  // Electron can report CDP input too. Match only the event being dispatched;
  // unrelated physical input gets its own user activation, even during agent work.
  function physicalInput(entry, contents, input) {
    const expected = dispatches.get(contents);
    if (expected && matchesInput(expected, input)) return;
    if (!['mouseDown', 'mouseUp', 'keyDown'].includes(input.type)) return;
    record(entry, contents, { initiator: 'user' });
  }

  async function dispatch(entry, contents, request, input, send) {
    dispatches.set(contents, input);
    if (!['mouseReleased', 'keyUp'].includes(input.type)) record(entry, contents, request);
    try {
      return await send();
    } finally {
      if (dispatches.get(contents) === input) dispatches.delete(contents);
    }
  }

  function consume(entry, contents, url) {
    const activation = activations.get(contents);
    activations.delete(contents);
    if (
      !activation ||
      activation.document !== entry.documents ||
      activation.expiresAt < now() ||
      (activation.destinationUrl && activation.destinationUrl !== new URL(url).href)
    )
      return { initiator: 'agent', autonomy: 'low' };
    return activation;
  }

  function forget(contents) {
    activations.delete(contents);
    dispatches.delete(contents);
  }

  return { record, physicalInput, dispatch, consume, forget };
}

function matchesInput(expected, actual) {
  if (expected.type === 'mousePressed' || expected.type === 'mouseReleased') {
    return (
      actual.type === (expected.type === 'mousePressed' ? 'mouseDown' : 'mouseUp') &&
      actual.x === expected.x &&
      actual.y === expected.y &&
      actual.button === expected.button
    );
  }
  return (
    ['keyDown', 'rawKeyDown', 'keyUp'].includes(expected.type) &&
    actual.type === (expected.type === 'keyUp' ? 'keyUp' : 'keyDown') &&
    actual.key === expected.key
  );
}

module.exports = { createBrowserNavigationProvenance };
