// Text from the accessibility tree, as agents read it.

const TEXT_ROLES = new Set(['StaticText', 'text']);

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { cleanText, TEXT_ROLES };
