// browser_read_text: one document's main content as light markdown, from the
// same accessibility tree browser_read_page reads. Text inside one element
// reads as one block; headings, list items and table rows get their markdown
// marks; links keep their (redacted) address; controls and field values are
// left out.

const vm = require('node:vm');

const REGEX_TIME_LIMIT_MS = 250;
const TEXT_ROLES = new Set(['StaticText', 'text']);
// Read as part of the surrounding text in browser_read_text.
const INLINE_ROLES = new Set([
  'strong',
  'emphasis',
  'mark',
  'code',
  'subscript',
  'superscript',
  'time',
  'insertion',
  'deletion',
]);
// Controls, chrome and page furniture that browser_read_text leaves out.
const NOT_TEXT_ROLES = new Set([
  'LabelText',
  'button',
  'tab',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'treeitem',
  'textbox',
  'searchbox',
  'combobox',
  'spinbutton',
  'slider',
  'checkbox',
  'radio',
  'switch',
  'listbox',
  'menu',
  'menubar',
  'toolbar',
  'tablist',
  'navigation',
  'banner',
  'contentinfo',
  'complementary',
  'search',
  'Iframe',
  'ListMarker',
  'InlineTextBox',
]);

function markdownOf(tree, render, { redactUrl, maxNodes, skip }) {
  const byId = new Map(tree.nodes.map((node) => [node.nodeId, node]));
  const childrenOf = (node) => (node.childIds ?? []).map((id) => byId.get(id)).filter(Boolean);
  const root =
    tree.nodes.find((node) => node.role?.value === 'main' && !node.ignored) ??
    tree.nodes.find((node) => !node.parentId);
  const blocks = [];
  let inline = [];
  let prefix = '';
  let lists = 0;
  let inlineOnly = 0;
  // Inside a heading, link or table cell, blocks only separate words.
  const flush = () => {
    if (inlineOnly) {
      inline.push(' ');
      return;
    }
    const text = cleanText(inline.join(''));
    inline = [];
    if (!text) return;
    blocks.push(prefix + text);
    prefix = '';
  };
  const visitChildren = (node) => childrenOf(node).forEach(visit);
  // The text inside a node, read from its children rather than its name:
  // Chromium folds the values of fields inside into that name.
  const textOf = (node) => {
    if (skip?.has(node.nodeId)) return '';
    const outer = inline;
    inline = [];
    inlineOnly++;
    visitChildren(node);
    inlineOnly--;
    const text = cleanText(inline.join(''));
    inline = outer;
    return text;
  };

  function visit(node) {
    if (render.processed >= maxNodes) {
      render.exhausted = true;
      return;
    }
    render.processed++;
    // A sensitive field, editable host included, is left out with its content.
    if (skip?.has(node.nodeId)) return;
    const role = node.role?.value ?? '';
    const name = cleanText(node.name?.value);
    if (node.ignored || role === 'none' || INLINE_ROLES.has(role)) {
      if (!(node.ignored && TEXT_ROLES.has(role))) visitChildren(node);
    } else if (TEXT_ROLES.has(role)) {
      inline.push(node.name?.value ?? '');
    } else if (role === 'link') {
      const url = node.properties?.find((property) => property.name === 'url')?.value?.value;
      const text = textOf(node) || labelOf(node);
      if (text) inline.push(url ? `[${text}](${redactUrl(url)})` : text);
    } else if (role === 'image') {
      if (name) inline.push(`[image: ${name}]`);
    } else if (NOT_TEXT_ROLES.has(role)) {
      // left out
    } else if (role === 'heading') {
      flush();
      const level = node.properties?.find((property) => property.name === 'level')?.value?.value;
      const text = textOf(node);
      // A heading inside a link or cell reads as that link's or cell's text.
      if (inlineOnly) inline.push(text);
      else if (text) {
        blocks.push(`${prefix}${'#'.repeat(headingLevel(level))} ${text}`);
        prefix = '';
      }
    } else if (role === 'listitem') {
      flush();
      prefix = `${'  '.repeat(Math.max(0, lists - 1))}- `;
      visitChildren(node);
      flush();
      prefix = '';
    } else if (role === 'row' || role === 'LayoutTableRow') {
      flush();
      const cells = childrenOf(node).map(textOf);
      // A table inside a heading, link or cell reads as part of its text.
      if (inlineOnly) inline.push(` ${cells.join(' ')} `);
      else if (cells.some(Boolean)) {
        blocks.push(`${prefix}| ${cells.join(' | ')} |`);
        prefix = '';
      }
    } else {
      flush();
      if (role === 'list') lists++;
      visitChildren(node);
      if (role === 'list') lists--;
      flush();
    }
  }

  if (root) visit(root);
  flush();
  return blocks.join('\n');
}

// The label an author gave an element (aria-label, title), never a name
// Chromium built from its content, which can hold a field's value.
function labelOf(node) {
  const source = node.name?.sources?.find((candidate) => candidate.value && !candidate.superseded);
  return ['aria-label', 'title'].includes(source?.attribute) ? cleanText(node.name?.value) : '';
}

function headingLevel(level) {
  return Math.min(6, Math.max(1, Math.round(Number(level)) || 2));
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Which lines match plain text, or a /regex/flags. An agent's pattern runs on
// the main thread, so it runs under a time limit; flags that make a regex
// stateful are dropped.
function matcher(query) {
  const regex = /^\/(.+)\/([a-z]*)$/.exec(String(query));
  if (!regex) {
    const needle = String(query).toLowerCase();
    return (texts) => texts.map((text) => text.toLowerCase().includes(needle));
  }
  const pattern = new RegExp(regex[1], regex[2].replace(/[gy]/g, ''));
  return (texts) => {
    try {
      return vm.runInNewContext(
        'texts.map((text) => pattern.test(text))',
        { texts, pattern },
        {
          timeout: REGEX_TIME_LIMIT_MS,
        },
      );
    } catch {
      throw new Error('That /regex/ took too long; search for plain text or a simpler pattern.');
    }
  };
}

module.exports = { markdownOf, cleanText, matcher, TEXT_ROLES };
