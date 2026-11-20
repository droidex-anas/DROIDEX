const { isSensitiveBrowserKey, redactBrowserDiagnosticUrl } = require('./browserDiagnostics.cjs');
const { INTERNAL_ATTR } = require('./browserDesignOverlay.cjs');
const { resolveSource } = require('./browserElementSource.cjs');

const redactedTextTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
const urlAttributes = new Set([
  'action',
  'archive',
  'background',
  'cite',
  'codebase',
  'data',
  'formaction',
  'href',
  'itemid',
  'manifest',
  'poster',
  'profile',
  'src',
  'usemap',
  'xlink:href',
]);
const redactedUrlAttributes = new Set(['ping', 'srcdoc', 'srcset', 'style']);

function inspectElement(selector) {
  if (!selector) throw new Error('Element inspection requires a selector.');
  const el = document.querySelector(selector);
  if (!el) throw new Error('The inspected browser element is no longer available.');
  const rect = el.getBoundingClientRect();
  const shown = withoutTypedContent(el);
  const text = safeElementText(shown, 1000);
  const name = cleanText(
    el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      directText(shown) ||
      text,
    240,
  );
  const iframe =
    el instanceof HTMLIFrameElement
      ? {
          src: sanitizeUrl(el.src || el.getAttribute('src') || ''),
          accessible: canAccessFrame(el),
        }
      : undefined;
  return {
    selector,
    tagName: el.tagName.toLowerCase(),
    role: roleFor(el) || undefined,
    name: name && name !== '[redacted]' ? name : undefined,
    text: text || undefined,
    attributes: attrsFor(el),
    styles: stylesFor(el),
    box: boxFor(rect),
    html: sanitizedOuterHtml(shown),
    iframe,
  };
}

// Native and ARIA fields, whose content is what someone entered or chose.
const FIELDS = [
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  ...['textbox', 'searchbox', 'combobox', 'listbox', 'spinbutton', 'slider'].map(
    (role) => `[role~="${role}" i]`,
  ),
].join(', ');

// A copy of an element without what its fields hold, its own included; an
// input's value never shows in its markup either.
function withoutTypedContent(el) {
  const clone = el.cloneNode(true);
  const redact = (node) => {
    if (node.textContent) node.textContent = '[redacted]';
  };
  if (el.isContentEditable || el.closest(FIELDS)) redact(clone);
  else for (const field of clone.querySelectorAll(FIELDS)) redact(field);
  return clone;
}

function canAccessFrame(frame) {
  try {
    return Boolean(frame.contentDocument);
  } catch {
    return false;
  }
}

function sanitizedOuterHtml(el) {
  const clone = el.cloneNode(true);
  if (redactedTextTags.has(clone.tagName)) {
    clone.textContent = '[redacted]';
  } else {
    for (const node of clone.querySelectorAll('script,style,noscript')) node.remove();
  }
  const nodes = [clone, ...clone.querySelectorAll('*')];
  for (const node of nodes) {
    for (const attr of Array.from(node.attributes || [])) {
      const name = attr.name.toLowerCase();
      if (isSensitiveAttribute(name, node)) {
        node.setAttribute(attr.name, '[redacted]');
      } else if (redactedUrlAttributes.has(name) || isMetaRefreshContent(name, node)) {
        node.setAttribute(attr.name, '[redacted]');
      } else if (urlAttributes.has(name)) {
        node.setAttribute(attr.name, sanitizeUrl(attr.value));
      }
    }
  }
  return String(clone.outerHTML || '').slice(0, 4000);
}

function elementSelection(el) {
  const selector = selectorFor(el);
  const verified = verifySelector(el, selector);
  const source = resolveSource(el);
  const anchor = buildAnchor(el, selector, source);
  const detail = buildDetail(el, selector, verified);
  return {
    anchor,
    detail,
    url: location.href,
    title: document.title,
    scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
  };
}

// A pick reads its element as inspectElement does: without what its fields
// hold, so typed or sensitive content never reaches the agent.
function buildAnchor(el, selector, source) {
  const rect = el.getBoundingClientRect();
  const tag = el.tagName.toLowerCase();
  const shown = withoutTypedContent(el);
  const text = safeElementText(shown, 80);
  const name = cleanText(
    el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      directText(shown) ||
      text,
    80,
  );
  return {
    id: `@live-${stableHash(selector)}`,
    kind: 'element',
    label: labelText(tag, source, name || text),
    tag,
    role: roleFor(el) || undefined,
    name: name || undefined,
    text: text || undefined,
    box: boxFor(rect),
    source,
  };
}

function buildDetail(el, selector, verified) {
  return {
    id: `@live-${stableHash(selector)}`,
    selector,
    selectorVerified: verified,
    attributes: attrsFor(el),
    styles: stylesFor(el),
    ancestors: ancestorsFor(el),
    html: cleanText(sanitizedOuterHtml(withoutTypedContent(el)), 400) || undefined,
  };
}

function labelText(tag, source, text) {
  const component = source && source.component ? `${source.component} \u203a ` : '';
  const quoted = text ? ` "${cleanText(text, 40)}"` : '';
  return `${component}<${tag}>${quoted}`;
}

function pickTarget(x, y) {
  let node = document.elementFromPoint(x, y);
  while (node && node.getAttribute && node.getAttribute(INTERNAL_ATTR)) node = node.parentElement;
  if (!node || node === document.documentElement) return null;
  return node;
}

function selectorFor(el) {
  if (el.id) {
    const selector = `#${cssEscape(el.id)}`;
    if (verifySelector(el, selector)) return selector;
  }
  const testId = el.getAttribute('data-testid');
  if (testId) {
    const selector = `[data-testid="${cssEscape(testId)}"]`;
    if (verifySelector(el, selector)) return selector;
  }
  const aria = el.getAttribute('aria-label');
  if (aria) {
    const selector = `${el.tagName.toLowerCase()}[aria-label="${cssEscape(aria)}"]`;
    if (verifySelector(el, selector)) return selector;
  }
  const parts = [];
  let node = el;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
    let part = node.tagName.toLowerCase();
    const parent = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    const selector = parts.join(' > ');
    if (verifySelector(el, selector)) return selector;
    node = parent;
  }
  return parts.join(' > ');
}

function verifySelector(el, selector) {
  if (!selector) return false;
  try {
    const matches = document.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === el;
  } catch {
    return false;
  }
}

function attrsFor(el) {
  const out = {};
  const secret = isSensitiveField(el);
  for (const name of [
    'id',
    'class',
    'data-testid',
    'aria-label',
    'title',
    'placeholder',
    'type',
    'href',
    'src',
    'action',
    'name',
    'value',
    'role',
  ]) {
    const value = el.getAttribute && el.getAttribute(name);
    if (!value) continue;
    if (isSensitiveAttribute(name, el) || (name === 'value' && secret)) {
      out[name] = '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022';
      continue;
    }
    out[name] = urlAttributes.has(name)
      ? sanitizeUrl(value).slice(0, 500)
      : String(value).slice(0, 160);
  }
  return out;
}

function isSensitiveAttribute(name, el) {
  if (name === 'nonce') return true;
  // A control's value, native or ARIA.
  if (['value', 'aria-valuenow', 'aria-valuetext'].includes(name) || name.startsWith('on'))
    return true;
  if (
    /(token|secret|password|passcode|credential|authori[sz]|auth(?!or)|signature|api[-_]?key|private[-_]?key|cookie|session|csrf|otp)/i.test(
      name,
    )
  )
    return true;
  if (name !== 'content') return false;
  const fieldName = String(el.getAttribute && el.getAttribute('name')).toLowerCase();
  return isSensitiveBrowserKey(fieldName);
}

function sanitizeUrl(value) {
  return redactBrowserDiagnosticUrl(value, location.href);
}

function isMetaRefreshContent(name, el) {
  return (
    name === 'content' &&
    el.tagName === 'META' &&
    String(el.getAttribute('http-equiv') || '').toLowerCase() === 'refresh'
  );
}

// Password and one-time-code fields must never reach the agent transcript, so
// their live values are redacted from every snapshot/detail payload.
function isSensitiveField(el) {
  if (!el || el.tagName !== 'INPUT') return false;
  const type = (el.getAttribute('type') || '').toLowerCase();
  if (type === 'password') return true;
  const auto = (el.getAttribute('autocomplete') || '').toLowerCase();
  return auto.includes('password') || auto === 'one-time-code';
}

function stylesFor(el) {
  const style = getComputedStyle(el);
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    display: style.display,
    padding: style.padding,
    margin: style.margin,
    border: style.border,
  };
}

function ancestorsFor(el) {
  const out = [];
  let node = el.parentElement;
  while (node && node !== document.body && node !== document.documentElement && out.length < 4) {
    const testId = node.getAttribute('data-testid');
    out.push({
      tag: node.tagName.toLowerCase(),
      selector: node.id
        ? `#${cssEscape(node.id)}`
        : testId
          ? `[data-testid="${cssEscape(testId)}"]`
          : undefined,
    });
    node = node.parentElement;
  }
  return out;
}

// What the hover label says: a name, the size, the font and its colour.
function hoverInfo(el, rect) {
  const style = getComputedStyle(el);
  const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
  return {
    name: hoverName(el),
    size: `${Math.round(rect.width)} × ${Math.round(rect.height)}`,
    font: `${family} ${Math.round(parseFloat(style.fontSize) * 10) / 10}px`,
    color: style.color,
  };
}

// Elements whose own words are their name.
const NAMED_BY_TEXT = new Set([
  'A',
  'BUTTON',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'LABEL',
  'LEGEND',
  'OPTION',
  'SUMMARY',
]);

// The component's name, else the element's accessible name, else its tag.
// Its words are read as a pick reads them, so a field's content never shows.
function hoverName(el) {
  const source = resolveSource(el);
  if (source.component) return source.component;
  const name = cleanText(
    el.getAttribute('aria-label') ||
      el.getAttribute('alt') ||
      el.getAttribute('title') ||
      el.getAttribute('placeholder') ||
      (NAMED_BY_TEXT.has(el.tagName) ? safeElementText(withoutTypedContent(el), 40) : ''),
    40,
  );
  return name && name !== '[redacted]' ? name : el.tagName.toLowerCase();
}

function boxFor(rect) {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function roleFor(el) {
  return (
    el.getAttribute('role') ||
    { A: 'link', BUTTON: 'button', INPUT: 'textbox', TEXTAREA: 'textbox', SELECT: 'combobox' }[
      el.tagName
    ] ||
    ''
  );
}

function directText(el) {
  if (redactedTextTags.has(el.tagName)) return '[redacted]';
  return cleanText(
    Array.from(el.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent || '')
      .join(' '),
  );
}

function safeElementText(el, max = 180) {
  if (redactedTextTags.has(el.tagName)) return '[redacted]';
  if (!el.querySelector('script,style,noscript')) {
    return cleanText(el.innerText || el.textContent, max);
  }
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('script,style,noscript')) node.remove();
  return cleanText(clone.textContent, max);
}

function cleanText(value, max = 180) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

function stableHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
}

module.exports = { boxFor, elementSelection, hoverInfo, inspectElement, pickTarget };
