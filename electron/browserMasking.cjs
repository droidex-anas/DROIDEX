// What agents never see: the value of a sensitive field, whether they read the
// page or look at it. A field is sensitive when its type, autocomplete, name,
// id, label or placeholder says so, or when its value is the login saved for
// the site (agents never see what browser_fill_login filled in). A field that
// cannot be checked counts as sensitive.

const {
  send,
  documentFrames,
  frameOffset,
  axTree,
  inViewport,
  boundsOf,
} = require('./browserFrames.cjs');
const { cleanText } = require('./browserText.cjs');
const { dropRef } = require('./browserRefs.cjs');

const MASK = '••••';
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
  async function maskFields(dbg, render, url) {
    if (render.fields.length === 0) return;
    const secrets = await secretsFor(url);
    for (const line of render.fields) {
      const { value } = line.field;
      // An empty field with nothing inside it, and a name that cannot carry
      // its content, has nothing to show or hide.
      if (!value && line.inside.length === 0 && !line.field.labelledBy) continue;
      const sensitive = await isSensitive(dbg, line.field, secrets);
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
  async function insideMaskedField(dbg, tree, node, frame, url) {
    const byId = new Map(tree.nodes.map((candidate) => [candidate.nodeId, candidate]));
    const secrets = await secretsFor(url);
    for (let parent = byId.get(node.parentId); parent; parent = byId.get(parent.parentId)) {
      const field = fieldOf(parent, frame);
      if (field && (await isSensitive(dbg, field, secrets))) return true;
    }
    return false;
  }

  // Boxes, in the page's viewport, of every sensitive field. A frame that
  // cannot be read fails the call, so a screenshot fails rather than show
  // what it could not check.
  async function sensitiveBoxes(dbg, url) {
    const secrets = await secretsFor(url);
    const boxes = [];
    for (const frame of await documentFrames(dbg, { strict: true })) {
      for (const node of (await axTree(dbg, frame)).nodes) {
        const field = fieldOf(node, frame);
        if (!field?.value || !(await isSensitive(dbg, field, secrets))) continue;
        const shape = await send(dbg, frame.sessionId, 'DOM.getContentQuads', {
          backendNodeId: field.backendNodeId,
        }).catch(() => undefined); // not rendered, so nothing to paint over
        if (!shape?.quads?.length) continue;
        const offset = await frameOffset(dbg, frame.sessionId);
        for (const quad of shape.quads) boxes.push(boundsOf(inViewport(quad, offset)));
      }
    }
    return boxes;
  }

  async function secretsFor(url) {
    const secrets = new Set((await savedSecretsFor(url)).map(cleanText));
    secrets.delete('');
    return secrets;
  }

  async function isSensitive(dbg, field, secrets) {
    const { backendNodeId, name, value, sessionId } = field;
    if (secrets.has(value) || SENSITIVE_FIELD.test(name)) return true;
    const described =
      backendNodeId &&
      (await send(dbg, sessionId, 'DOM.describeNode', { backendNodeId }).catch(() => undefined));
    return !described || isSensitiveField(described.node.attributes ?? []);
  }

  return { maskFields, sensitiveBoxes, insideMaskedField };
}

// Nodes whose accessible name Chromium built from the page while a field sits
// inside them: from their content, a legend or a caption, which folds in the
// field's value ("Code 424242" for a heading holding a code field). They are
// read without that name; their content reads on its own, with the field
// masked like any other. A name from an attribute (aria-label, title, alt) is
// kept.
function foldedNames(nodes) {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const holdsField = new Set();
  for (const node of nodes) {
    if (!VALUE_ROLES.has(node.role?.value)) continue;
    let parent = byId.get(node.parentId);
    while (parent && !holdsField.has(parent.nodeId)) {
      holdsField.add(parent.nodeId);
      parent = byId.get(parent.parentId);
    }
  }
  return new Set([...holdsField].filter((nodeId) => nameFromPage(byId.get(nodeId))));
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
  if (!VALUE_ROLES.has(node.role?.value) || node.ignored) return undefined;
  return {
    backendNodeId: node.backendDOMNodeId,
    name: cleanText(node.name?.value),
    value: cleanText(node.value?.value),
    // A field labelled through aria-labelledby can be labelled by itself, and
    // then its name is its own content.
    labelledBy: nameSource(node)?.attribute === 'aria-labelledby',
    sessionId: frame.sessionId,
  };
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

module.exports = { createBrowserMasking, fieldOf, foldedNames };
