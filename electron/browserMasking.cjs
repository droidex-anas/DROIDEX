// What agents never see: the value of a sensitive field. A field is sensitive
// when its type, autocomplete, name, id, label or placeholder says so, or when
// its value is the login saved for the site (agents never see what
// browser_fill_login filled in). A field that cannot be checked counts as
// sensitive.

const { cleanText } = require('./browserText.cjs');
const { dropRef } = require('./browserRefs.cjs');

const MASK = '••••';
const VALUE_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton', 'slider']);
const SENSITIVE_FIELD =
  /pass|otp|one.?time|verif|2fa|mfa|token|secret|credential|\bauth\b|api.?key|access.?key|private.?key|\bkey\b|cvc|cvv|csc|card.?num|cc-|security.?code|\bpin\b|ssn|iban/i;

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

  return { maskFields, secretsFor, isSensitive };
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

module.exports = { createBrowserMasking, fieldOf };
