// What agents never see: the value of a sensitive field, whether they read the
// page or look at it. A field is sensitive when its type, autocomplete, name,
// id, label or placeholder says so, or when its value is the login saved for
// the site (agents never see what browser_fill_login filled in). A field that
// cannot be checked counts as sensitive.
//
// This covers fields as pages show them: their values and contents, and the
// names Chromium builds from them. A page that copies a value somewhere else
// (into other text, an attribute, a label it points at a hidden field) shows
// it like any other text; nothing here can hide what the page itself prints.

const { send, documentFrames, viewportMapping, axTree, boundsOf } = require('./browserFrames.cjs');
const { cleanText } = require('./browserText.cjs');
const { dropRef } = require('./browserRefs.cjs');

const MASK = '••••';
const TEXT_NODE = 3;
const VALUE_ROLES = new Set([
  'textbox',
  'searchbox',
  'combobox',
  'listbox',
  'spinbutton',
  'slider',
]);
// A field holding one of these never shows its value to an agent.
const SENSITIVE_FIELD =
  /pass|otp|one.?time|verif|2fa|mfa|token|secret|credential|auth(?!or)|authoriz|api.?key|access.?key|private.?key|\bkey\b|cvc|cvv|csc|card.?num|cc-|security.?code|\bpin\b|ssn|iban/i;

function createBrowserMasking({ savedSecretsFor }) {
  // Field lines from browser_read_page show their value or the mask. What is
  // inside a masked field, such as a select's options, is hidden and its refs
  // are forgotten.
  async function maskFields(dbg, render) {
    if (render.fields.length === 0) return;
    const logins = savedLogins();
    for (const line of render.fields) {
      const { value } = line.field;
      // An empty field with nothing inside it, and a name that cannot carry
      // its content, has nothing to show or hide.
      if (!value && line.inside.length === 0 && !line.field.labelledBy) continue;
      const sensitive = await isSensitive(dbg, line.field, logins);
      if (value) line.text += `: ${sensitive ? MASK : value}`;
      if (!sensitive) continue;
      // A masked field's name goes too when it may carry what the field holds.
      if (line.field.labelledBy || (value && line.field.name.includes(value)))
        line.text = line.text.replace(`"${line.name}"`, `"${MASK}"`);
      for (const inner of line.inside) {
        inner.hidden = true;
        if (inner.ref) dropRef(render.entry, inner.ref);
      }
    }
    render.lines = render.lines.filter((line) => !line.hidden);
  }

  // A ref inside a masked field reads as nothing, however the agent got it.
  async function insideMaskedField(dbg, tree, node, frame) {
    const byId = new Map(tree.nodes.map((candidate) => [candidate.nodeId, candidate]));
    const logins = savedLogins();
    for (let parent = byId.get(node.parentId); parent; parent = byId.get(parent.parentId)) {
      const field = fieldOf(parent, frame);
      if (field && (await isSensitive(dbg, field, logins))) return true;
    }
    return false;
  }

  // Boxes, in the page's viewport, of every sensitive field: the ones the
  // accessibility tree names, any field whose own attributes say so, and any
  // input, textarea, select or editable element the tree hides (aria-hidden,
  // inert), whose value nothing here can check. A frame that cannot be read fails the call, so a
  // screenshot fails rather than show what it could not check.
  async function sensitiveBoxes(dbg) {
    const logins = savedLogins();
    const nodes = new Map(); // `${sessionId}:${backendNodeId}` -> { sessionId, backendNodeId, editable }
    const add = (sessionId, backendNodeId, editable) =>
      nodes.set(`${sessionId}:${backendNodeId}`, { sessionId, backendNodeId, editable });
    const shown = new Set(); // `${sessionId}:${backendNodeId}` the tree does not hide
    const frames = await documentFrames(dbg, { strict: true });
    for (const frame of frames) {
      for (const node of (await axTree(dbg, frame)).nodes) {
        if (!node.ignored) shown.add(`${frame.sessionId}:${node.backendDOMNodeId}`);
        const field = fieldOf(node, frame);
        if ((field?.value || field?.editable) && (await isSensitive(dbg, field, logins)))
          add(frame.sessionId, field.backendNodeId, field.editable);
      }
    }
    for (const sessionId of new Set(frames.map((frame) => frame.sessionId)))
      for (const input of await inputsOf(dbg, sessionId)) {
        const attribute = attributeOf(input, 'contenteditable');
        const editable = attribute !== undefined && attribute !== 'false';
        const hidden =
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(input.nodeName) || editable) &&
          !shown.has(`${sessionId}:${input.backendNodeId}`);
        if (hidden || isSensitiveField(input.attributes ?? []))
          add(sessionId, input.backendNodeId, editable);
      }
    const boxes = [];
    const mappings = new Map(); // sessionId -> its frame's mapping to the viewport
    for (const { sessionId, backendNodeId, editable } of nodes.values()) {
      const shape = await send(dbg, sessionId, 'DOM.getContentQuads', { backendNodeId }).catch(
        (error) => {
          // Not rendered means nothing to paint over; anything else fails.
          if (/could not compute content quads/i.test(String(error?.message))) return undefined;
          throw error;
        },
      );
      if (!shape?.quads?.length) continue;
      // Text in an editable region can paint past its box.
      const quads = editable
        ? [...shape.quads, ...(await textQuads(dbg, sessionId, backendNodeId))]
        : shape.quads;
      if (!mappings.has(sessionId)) mappings.set(sessionId, await viewportMapping(dbg, sessionId));
      for (const quad of quads) boxes.push(boundsOf(mappings.get(sessionId)(quad)));
    }
    return boxes;
  }

  // The login saved for each origin, looked up once per call: a field is
  // checked against the login of the frame it is in.
  function savedLogins() {
    const byOrigin = new Map();
    return async (origin) => {
      if (!byOrigin.has(origin)) {
        const values = new Set((await savedSecretsFor(origin)).map(cleanText));
        values.delete('');
        byOrigin.set(origin, values);
      }
      return byOrigin.get(origin);
    };
  }

  async function isSensitive(dbg, field, logins) {
    const { backendNodeId, name, value, sessionId, origin } = field;
    if ((await logins(origin)).has(value) || SENSITIVE_FIELD.test(name)) return true;
    const described =
      backendNodeId &&
      (await send(dbg, sessionId, 'DOM.describeNode', { backendNodeId }).catch(() => undefined));
    return !described || isSensitiveField(described.node.attributes ?? []);
  }

  // The nodes of sensitive fields in one tree, for reads that leave them out.
  async function sensitiveNodes(dbg, tree, frame) {
    const logins = savedLogins();
    const nodes = new Set();
    for (const node of tree.nodes) {
      const field = fieldOf(node, frame);
      if ((field?.value || field?.editable) && (await isSensitive(dbg, field, logins)))
        nodes.add(node.nodeId);
    }
    return nodes;
  }

  return { maskFields, sensitiveBoxes, insideMaskedField, sensitiveNodes };
}

// Nodes whose accessible name Chromium built from a field's surroundings,
// which folds in what the field holds ("Code 424242" for a heading holding a
// code field): a name from the content, legend or caption of a node with a
// field inside it, or one through aria-labelledby from a field, from what
// holds one, or from what sits in one. They are read without that name; their
// content reads on its own, with the field masked like any other. A name from
// another attribute (aria-label, title, alt) is kept.
function foldedNames(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const byBackendId = new Map(nodes.map((node) => [node.backendDOMNodeId, node]));
  const holdsField = new Set();
  const nearField = new Set(); // fields, what holds them and what they hold
  const holdAll = (node) => {
    nearField.add(node.nodeId);
    for (const id of node.childIds ?? []) if (byId.has(id)) holdAll(byId.get(id));
  };
  for (const node of nodes) {
    if (!isField(node)) continue;
    holdAll(node);
    let parent = byId.get(node.parentId);
    while (parent && !holdsField.has(parent.nodeId)) {
      holdsField.add(parent.nodeId);
      nearField.add(parent.nodeId);
      parent = byId.get(parent.parentId);
    }
  }
  const folded = new Set([...holdsField].filter((nodeId) => nameFromPage(byId.get(nodeId))));
  for (const node of nodes) {
    const source = nameSource(node);
    if (source?.attribute !== 'aria-labelledby') continue;
    // A field labelled by itself is masked with its own value.
    const labels = (source.attributeValue?.relatedNodes ?? [])
      .map((label) => byBackendId.get(label.backendDOMNodeId))
      .filter((label) => label && label !== node);
    if (labels.some((label) => nearField.has(label.nodeId))) folded.add(node.nodeId);
  }
  return folded;
}

// The name in effect is the first source with a value that nothing overrides;
// one with no attribute behind it was built from the page.
function nameFromPage(node) {
  const source = nameSource(node);
  return Boolean(source) && !source.attribute;
}

function nameSource(node) {
  return node.name?.sources?.find((candidate) => candidate.value && !candidate.superseded);
}

// A field whose value is shown or masked; the value may be empty, as in a
// select with nothing chosen.
function fieldOf(node, frame) {
  if (!isField(node)) return undefined;
  return {
    backendNodeId: node.backendDOMNodeId,
    name: cleanText(node.name?.value),
    value: cleanText(node.value?.value),
    editable: isEditableRoot(node),
    // A field labelled through aria-labelledby can be labelled by itself, and
    // then its name is its own content.
    labelledBy: nameSource(node)?.attribute === 'aria-labelledby',
    sessionId: frame.sessionId,
    origin: frame.securityOrigin || frame.url,
  };
}

// Where an editable field's text is painted, inside its box or out of it on
// any side: CDP's quads for each of its text nodes, which Chromium lays out with
// every transform on the way already applied (frames, the page, shadow trees,
// closed ones included). A field with more text nodes than this fails the
// capture rather than go unmasked.
const MAX_TEXT_NODES = 300;

async function textQuads(dbg, sessionId, backendNodeId) {
  const { node } = await send(dbg, sessionId, 'DOM.describeNode', {
    backendNodeId,
    depth: -1,
    pierce: true,
  });
  const texts = [];
  const walk = (item) => {
    if (item.nodeType === TEXT_NODE) texts.push(item.backendNodeId);
    for (const child of [...(item.children ?? []), ...(item.shadowRoots ?? [])]) walk(child);
  };
  walk(node);
  if (texts.length > MAX_TEXT_NODES)
    throw new Error('A sensitive field on this page holds too much text to mask.');
  const quads = [];
  for (const text of texts) {
    const shape = await send(dbg, sessionId, 'DOM.getContentQuads', { backendNodeId: text }).catch(
      () => undefined,
    );
    quads.push(...(shape?.quads ?? []));
  }
  return quads;
}

// Every input, textarea and select in a session's documents, shadow roots
// and same-process frames included.
async function inputsOf(dbg, sessionId) {
  await send(dbg, sessionId, 'DOM.getDocument', { depth: 0 });
  const { searchId, resultCount } = await send(dbg, sessionId, 'DOM.performSearch', {
    query: 'input, textarea, select, [contenteditable]',
  });
  try {
    if (!resultCount) return [];
    const { nodeIds } = await send(dbg, sessionId, 'DOM.getSearchResults', {
      searchId,
      fromIndex: 0,
      toIndex: resultCount,
    });
    const inputs = [];
    for (const nodeId of nodeIds)
      inputs.push((await send(dbg, sessionId, 'DOM.describeNode', { nodeId })).node);
    return inputs;
  } finally {
    await send(dbg, sessionId, 'DOM.discardSearchResults', { searchId }).catch(() => undefined);
  }
}

function isField(node) {
  return !node.ignored && (VALUE_ROLES.has(node.role?.value) || isEditableRoot(node));
}

// A contenteditable host: editable, and the one element of it that takes focus.
function isEditableRoot(node) {
  const properties = node.properties ?? [];
  return (
    properties.some((property) => property.name === 'editable') &&
    properties.some((property) => property.name === 'focusable' && property.value?.value)
  );
}

function attributeOf(node, name) {
  const attributes = node.attributes ?? [];
  for (let i = 0; i < attributes.length; i += 2)
    if (attributes[i].toLowerCase() === name) return attributes[i + 1];
  return undefined;
}

function isSensitiveField(attributes) {
  for (let i = 0; i < attributes.length; i += 2) {
    const [name, value] = [attributes[i].toLowerCase(), String(attributes[i + 1] ?? '')];
    if (name === 'type' && value.toLowerCase() === 'password') return true;
    if (
      ['autocomplete', 'name', 'id', 'aria-label', 'placeholder'].includes(name) &&
      SENSITIVE_FIELD.test(value)
    )
      return true;
  }
  return false;
}

module.exports = { createBrowserMasking, fieldOf, foldedNames, isField };
