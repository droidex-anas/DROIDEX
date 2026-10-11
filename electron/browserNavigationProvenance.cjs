const ACTIVATION_TTL_MS = 1_000;

function createBrowserNavigationProvenance({ now = Date.now } = {}) {
  const activations = new WeakMap();

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

  // A navigation belongs to the agent input that dispatched it: physical input
  // never takes over a live agent claim. Only a click, Enter or Space is a
  // gesture that can start a user navigation; Electron also reports CDP input
  // here, which the agent's own claim covers.
  function physicalInput(entry, contents, input) {
    if (!startsNavigation(input)) return;
    const claim = activations.get(contents);
    if (claim?.initiator === 'agent' && isLive(claim, entry)) return;
    record(entry, contents, { initiator: 'user' });
  }

  function consume(entry, contents, url) {
    const activation = activations.get(contents);
    activations.delete(contents);
    if (
      !activation ||
      !isLive(activation, entry) ||
      (activation.destinationUrl && activation.destinationUrl !== new URL(url).href)
    )
      return { initiator: 'agent', autonomy: 'low' };
    return activation;
  }

  function isLive(activation, entry) {
    return activation.document === entry.documents && activation.expiresAt >= now();
  }

  function forget(contents) {
    activations.delete(contents);
  }

  return { record, physicalInput, consume, forget };
}

function startsNavigation(input) {
  if (input.type === 'mouseDown' || input.type === 'mouseUp') return true;
  return input.type === 'keyDown' && (input.key === 'Enter' || input.key === ' ');
}

module.exports = { createBrowserNavigationProvenance };
