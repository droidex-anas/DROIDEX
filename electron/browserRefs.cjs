// Refs name DOM nodes for agents: `e12` is one node in one document and is
// never handed out twice. The registry lives on the browser session's entry,
// so refs outlive guests and documents and an old one can be recognised.

const MAX_REMEMBERED_REFS = 50_000;

function registryFor(entry) {
  entry.refs ??= { next: 1, byNode: new Map(), byRef: new Map() };
  return entry.refs;
}

function refFor(entry, document, backendNodeId) {
  const registry = registryFor(entry);
  const key = `${document}:${backendNodeId}`;
  const ref = registry.byNode.get(key) ?? `e${registry.next++}`;
  registry.byNode.set(key, ref);
  // Re-inserted, so eviction (oldest first) never drops a ref just handed out.
  registry.byRef.delete(ref);
  registry.byRef.set(ref, { document, backendNodeId });
  return ref;
}

// The document and node a ref was issued for, if it is still remembered.
function knownRef(entry, ref) {
  return registryFor(entry).byRef.get(ref);
}

// Forgets the least recently issued refs beyond the limit; called once an
// answer is ready, so the refs in it stay usable.
function forgetRefs(entry) {
  const registry = registryFor(entry);
  const excess = registry.byRef.size - MAX_REMEMBERED_REFS;
  if (excess <= 0) return;
  for (const ref of [...registry.byRef.keys()].slice(0, excess)) {
    const { document, backendNodeId } = registry.byRef.get(ref);
    registry.byRef.delete(ref);
    registry.byNode.delete(`${document}:${backendNodeId}`);
  }
}

// A ref an agent must not use, such as one inside a masked field.
function dropRef(entry, ref) {
  const registry = registryFor(entry);
  const known = registry.byRef.get(ref);
  if (!known) return;
  registry.byRef.delete(ref);
  registry.byNode.delete(`${known.document}:${known.backendNodeId}`);
}

module.exports = { refFor, knownRef, forgetRefs, dropRef };
