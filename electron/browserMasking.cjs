// What agents never see: the value of a sensitive field. A field is sensitive
// when its type, autocomplete, name, id, label or placeholder says so, or when
// its value is the login saved for the site (agents never see what
// browser_fill_login filled in). A field that cannot be checked counts as
// sensitive.

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
      // An empty field with nothing inside it has nothing to show or hide.
      if (!value && line.inside.length === 0) continue;
      const sensitive = await isSensitive(dbg, line.field, secrets);
      if (value) line.text += `: ${sensitive ? MASK : value}`;
      if (!sensitive) continue;
      for (const inner of line.inside) {
        inner.hidden = true;
        if (inner.ref) dropRef(render.entry, inner.ref);
      }
    }
    render.lines = render.lines.filter((line) => !line.hidden);
  }

  // A ref inside a masked field reads as nothing, however the agent got it.
  async function insideMaskedField(dbg, tree, node, url) {
    const byId = new Map(tree.nodes.map((candidate) => [candidate.nodeId, candidate]));
    const secrets = await secretsFor(url);
    for (let parent = byId.get(node.parentId); parent; parent = byId.get(parent.parentId)) {
      const field = fieldOf(parent);
      if (field && (await isSensitive(dbg, field, secrets))) return true;
    }
    return false;
  }

  async function secretsFor(url) {
    const secrets = new Set((await savedSecretsFor(url)).map(cleanText));
    secrets.delete('');
    return secrets;
  }

  async function isSensitive(dbg, field, secrets) {
    const { backendNodeId, name, value } = field;
    if (secrets.has(value) || SENSITIVE_FIELD.test(name)) return true;
    const described =
      backendNodeId &&
      (await dbg.sendCommand('DOM.describeNode', { backendNodeId }).catch(() => undefined));
    return !described || isSensitiveField(described.node.attributes ?? []);
  }

  return { maskFields, insideMaskedField };
}

// Nodes whose accessible name Chromium built from their content while a field
// sits inside them: the name folds in the field's value ("Code 424242" for a
// heading holding a code field). They are read without that name; their
// content reads on its own, with the field masked like any other. A name from
// aria-label or the like is kept.
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
  return new Set([...holdsField].filter((nodeId) => nameFromContents(byId.get(nodeId))));
}

// The name in effect is the first source with a value that nothing overrides.
function nameFromContents(node) {
  const source = node.name?.sources?.find((candidate) => candidate.value && !candidate.superseded);
  return source?.type === 'contents';
}

// A field whose value is shown or masked; the value may be empty, as in a
// select with nothing chosen.
function fieldOf(node) {
  if (!VALUE_ROLES.has(node.role?.value) || node.ignored) return undefined;
  return {
    backendNodeId: node.backendDOMNodeId,
    name: cleanText(node.name?.value),
    value: cleanText(node.value?.value),
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
