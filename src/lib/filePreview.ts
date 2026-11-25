/**
 * Renderer helpers for the Files preview pane: DOCX sanitization, PDF loading,
 * and delimited-text parsing. Preview categories come from the main process
 * (`electron/files.cjs`) in the `readPreview` payload.
 */

import type { HElement } from 'docx-preview';
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';

export const DOCX_PREVIEW_OPTIONS = {
  inWrapper: true,
  ignoreWidth: false,
  ignoreHeight: false,
  breakPages: true,
  experimental: false,
  // docx-preview renders alt chunks as unsandboxed srcdoc iframes.
  renderAltChunks: false,
  className: 'docx-preview',
} as const;

const DOCX_ACTIVE_CONTENT_SELECTOR = 'script, iframe, object, embed, link, meta, base, form';
const DOCX_URL_ATTRIBUTES = new Set([
  'href',
  'xlink:href',
  'src',
  'action',
  'formaction',
  'poster',
]);
const DOCX_MARKUP_ATTRIBUTES = new Set(['innerhtml', 'outerhtml', 'srcdoc']);

function isSafeDocxUrl(value: string): boolean {
  let normalized = '';
  for (const character of value.trim()) {
    const codePoint = character.charCodeAt(0);
    if (codePoint > 0x20 && codePoint !== 0x7f) normalized += character;
  }
  return normalized === '' || normalized.startsWith('#') || /^blob:/i.test(normalized);
}

function normalizeCssForSecurity(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\\(?:\r\n|[\n\r\f])/g, '')
    .replace(
      /\\([0-9a-f]{1,6})(?:[ \n\r\t\f])?|\\([^0-9a-f\n\r\f])/gi,
      (_match, hex: string | undefined, escaped: string | undefined) => {
        if (!hex) return escaped ?? '';
        const codePoint = Number.parseInt(hex, 16);
        return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : '\ufffd';
      },
    )
    .toLowerCase();
}

export function sanitizeDocxCssText(css: string): string {
  const normalized = normalizeCssForSecurity(css);
  if (/@import(?:\s|["'(;]|$)/i.test(normalized)) return '';

  let unsafeUrl = false;
  const withoutBlobUrls = normalized.replace(
    /url\s*\(\s*(['"]?)([^)]*?)\1\s*\)/gi,
    (match, _quote: string, value: string) => {
      if (/^blob:[^'"\s()]+$/i.test(value.trim())) return '';
      unsafeUrl = true;
      return match;
    },
  );
  if (unsafeUrl || /url\s*\(/i.test(withoutBlobUrls)) return '';
  if (
    /(?:https?|ftp|file|data|javascript|vbscript)\s*:/i.test(withoutBlobUrls) ||
    /(^|[^:])\/\//.test(withoutBlobUrls)
  ) {
    return '';
  }
  return css;
}

function sanitizeDocxStyle(style: HElement['style']): HElement['style'] | undefined {
  if (typeof style === 'string') return sanitizeDocxCssText(style) || undefined;
  if (!style) return undefined;

  const sanitized = Object.fromEntries(
    Object.entries(style).filter(
      ([property, value]) => sanitizeDocxCssText(`${property}:${value}`) !== '',
    ),
  );
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

export function createSanitizedDocxElementFactory(document: Document) {
  const blockedTags = new Set(
    DOCX_ACTIVE_CONTENT_SELECTOR.split(',').map((selector) => selector.trim()),
  );

  const create = (input: HElement | Node | string): Node => {
    if (typeof input === 'string') return document.createTextNode(input);
    if (typeof (input as Node).nodeType === 'number') return input as Node;

    const { ns, tagName, className, style, children, ...props } = input as HElement;
    const normalizedTag = tagName.toLowerCase();
    if (normalizedTag === '#fragment') return document.createDocumentFragment();
    if (normalizedTag === '#comment') {
      return document.createComment(String(children?.[0] ?? ''));
    }
    if (blockedTags.has(normalizedTag)) return document.createDocumentFragment();

    const element = ns ? document.createElementNS(ns, tagName) : document.createElement(tagName);
    if (className) element.setAttribute('class', className);

    const safeStyle = sanitizeDocxStyle(style);
    if (typeof safeStyle === 'string') {
      element.setAttribute('style', safeStyle);
    } else if (safeStyle) {
      Object.assign((element as HTMLElement).style, safeStyle);
    }

    for (const [name, value] of Object.entries(props)) {
      const normalizedName = name.toLowerCase();
      if (
        value === undefined ||
        normalizedName.startsWith('on') ||
        DOCX_MARKUP_ATTRIBUTES.has(normalizedName) ||
        (DOCX_URL_ATTRIBUTES.has(normalizedName) && !isSafeDocxUrl(String(value)))
      ) {
        continue;
      }
      (element as unknown as Record<string, unknown>)[name] = value;
    }

    for (const child of children ?? []) element.appendChild(create(child));
    return element;
  };

  return create;
}

export function sanitizeDocxPreview(container: ParentNode): void {
  container.querySelectorAll('style').forEach((element) => {
    const css = sanitizeDocxCssText(element.textContent ?? '');
    if (!css) element.remove();
    else element.textContent = css;
  });

  container.querySelectorAll(DOCX_ACTIVE_CONTENT_SELECTOR).forEach((element) => {
    element.remove();
  });

  container.querySelectorAll('*').forEach((element) => {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith('on') ||
        DOCX_MARKUP_ATTRIBUTES.has(name) ||
        (name === 'style' && !sanitizeDocxCssText(attribute.value)) ||
        (DOCX_URL_ATTRIBUTES.has(name) && !isSafeDocxUrl(attribute.value))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  });
}

export async function loadPdfDocumentForPreview(
  loadLibrary: () => Promise<{
    getDocument: (input: { data: Uint8Array; isEvalSupported: boolean }) => PDFDocumentLoadingTask;
  }>,
  bytes: Uint8Array,
  isCancelled: () => boolean,
  onLoadingTask: (task: PDFDocumentLoadingTask) => void,
): Promise<PDFDocumentProxy | null> {
  const pdfjsLib = await loadLibrary();
  if (isCancelled()) return null;
  const loadingTask = pdfjsLib.getDocument({
    data: bytes.slice(),
    isEvalSupported: false,
  });
  onLoadingTask(loadingTask);
  const doc = await loadingTask.promise;
  if (isCancelled()) return null;
  return doc;
}

function readQuotedCharacter(
  text: string,
  index: number,
): { value: string; nextIndex: number; closed: boolean } {
  const ch = text[index];
  if (ch !== '"') return { value: ch, nextIndex: index, closed: false };
  if (text[index + 1] === '"') return { value: '"', nextIndex: index + 1, closed: false };
  return { value: '', nextIndex: index, closed: true };
}

export function parseDelimitedText(
  text: string,
  delimiter: string,
  rowLimit: number,
  columnLimit: number,
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let columnLimitReached = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      const quoted = readQuotedCharacter(text, i);
      i = quoted.nextIndex;
      if (quoted.closed) {
        inQuotes = false;
      } else if (!columnLimitReached) {
        field += quoted.value;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      if (row.length < columnLimit - 1) {
        row.push(field);
        field = '';
      } else {
        columnLimitReached = true;
      }
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      columnLimitReached = false;
      if (rows.length >= rowLimit) break;
    } else if (!columnLimitReached) {
      field += ch;
    }
  }

  if (rows.length < rowLimit && (field || row.length)) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
