import { parseTruncatedTail } from './tools';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

// Parse the WebSearch tool result text. Each result is a block separated by a
// "---" line:
//   Web Search Results for: "<query>"
//
//   **<Title>**
//      URL: https://…
//
//      <snippet, possibly ending with …>
//   ---
//   Found N results
export function parseWebSearch(text: string): {
  query?: string;
  count?: number;
  results: WebSearchResult[];
} {
  const results: WebSearchResult[] = [];
  const clean = text.replace(/\r\n/g, '\n');
  const query = /Web Search Results for:\s*"([\s\S]*?)"\s*\n/.exec(clean)?.[1]?.trim();
  const countMatch = /Found\s+(\d+)\s+results?/i.exec(clean);
  const re =
    /\*\*(.+?)\*\*[ \t]*\n[ \t]*URL:[ \t]*(\S+)([\s\S]*?)(?=\n[ \t]*-{3,}[ \t]*\n|\nFound \d+ results?|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    const snippet = m[3]
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
      .trim();
    results.push({ title: m[1].trim(), url: m[2].trim(), snippet });
  }
  const count = countMatch ? Number(countMatch[1]) : results.length || undefined;
  return { query, count, results };
}

export interface WebFetchPage {
  url?: string;
  title?: string;
  /** Readable page body with the history truncation sentinel stripped. */
  body: string;
  /** Character count of the cleaned body (for a compact badge). */
  chars: number;
  truncatedChars: number | null;
}

function firstNonEmptyLine(text: string): string | undefined {
  return text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
}

function inferFetchTitle(clean: string, h1?: string, titleMeta?: string): string | undefined {
  if (h1) return h1;
  if (titleMeta) return titleMeta;
  const first = firstNonEmptyLine(clean);
  if (!first || first.length > 120) return undefined;
  if (/^https?:\/\//i.test(first) || /^URL:/i.test(first)) return undefined;
  const stripped = first
    .replace(/^#+\s*/, '')
    .replace(/^\*+|\*+$/g, '')
    .trim();
  return stripped.length > 0 ? stripped : undefined;
}

// Fetch results prepend a small metadata preamble (`Title: …`, `URL: …`) before
// the page body, so only the opening lines are metadata candidates. Matching
// document-wide would strip genuine body lines that begin with "Title:"/"URL:".
const FETCH_META_PREAMBLE_LINES = 5;

function stripFetchMeta(
  clean: string,
  opts: { h1?: string; titleMeta?: string; urlLine?: string; firstLineTitle?: boolean },
): string {
  let preview = clean;
  if (opts.titleMeta) preview = preview.replace(/^Title:\s*.+$/im, '');
  if (opts.urlLine) preview = preview.replace(/^URL:\s*\S+$/im, '');
  if (opts.h1) preview = preview.replace(/^#\s+.+$/m, '');
  // A title inferred from the first body line would otherwise repeat as the
  // body's opening line; drop it so the card's title and preview stay distinct.
  // Safe after the removals above: in the fallback case the first line is never
  // a Title:/URL:/# line, so those removals cannot change which line leads.
  if (opts.firstLineTitle) {
    preview = preview.replace(/^[^\n]*(?:\n|$)/, '');
  }
  // Whatever was stripped renders in the card's title or source row, so when
  // nothing else remains (a one-line page, an h1-only page, or bare Title:/URL:
  // metadata) an empty body is legitimate — restoring `clean` would duplicate
  // the title or leak metadata as the body.
  return preview.replace(/^\n+/, '').trim();
}

// Pull a title + clean body out of a FetchUrl-style tool result so the UI can
// render a source card instead of a mono dump. Title sources (first match wins):
//   1. markdown `# heading`
//   2. `Title: …` metadata line (preamble only — see FETCH_META_PREAMBLE_LINES)
//   3. first short non-URL line (stripped from the body so it isn't duplicated)
// The URL prefers the tool arg; a `URL: …` preamble line is the fallback.
export function parseWebFetch(text: string, urlFromArgs?: string): WebFetchPage {
  const { body: stripped, truncatedChars } = parseTruncatedTail(text);
  const clean = stripped.replace(/\r\n/g, '\n').trim();
  const preamble = clean.split('\n').slice(0, FETCH_META_PREAMBLE_LINES).join('\n');
  const urlLine = /^URL:\s*(\S+)/im.exec(preamble)?.[1]?.trim();
  const argUrl = urlFromArgs?.trim();
  const url = argUrl && argUrl.length > 0 ? argUrl : urlLine;

  const h1 = /^#\s+(.+)$/m.exec(clean)?.[1]?.trim();
  const titleMeta = /^Title:\s*(.+)$/im.exec(preamble)?.[1]?.trim();
  const title = inferFetchTitle(clean, h1, titleMeta);
  const firstLineTitle = title !== undefined && h1 === undefined && titleMeta === undefined;
  const body = stripFetchMeta(clean, {
    h1: title ? h1 : undefined,
    titleMeta,
    urlLine,
    firstLineTitle,
  });

  return { url, title, body, chars: body.length, truncatedChars };
}

// A fetch body that is raw HTML (doctype / dense tag soup) reads worse as
// rendered markdown than as a mono block, so the card keeps it in a <pre>.
export function looksLikeHtml(text: string): boolean {
  const t = text.trimStart();
  if (/^<!doctype\s+html/i.test(t) || /^<html[\s>]/i.test(t)) return true;
  const sample = t.slice(0, 2000);
  const tags = sample.match(/<\/?[a-z][a-z0-9]*(\s[^>\n]*)?>/gi)?.length ?? 0;
  return tags >= 8;
}

// Compact badge label for a character count (e.g. 1240 → "1.2k").
export function formatCharCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) {
    const v = Math.round(n / 100) / 10;
    const label = v % 1 === 0 ? v.toFixed(0) : v.toFixed(1);
    return `${label}k`;
  }
  return `${String(Math.round(n / 1000))}k`;
}

// Human-friendly source label from a URL: the registrable name, capitalized
// (e.g. https://www.theregister.com/… → "Theregister"). Falls back to the URL.
// "bbc.co.uk" → "Bbc", "vitejs.dev" → "Vitejs": the label before a public
// suffix, where a two-letter second level (co.uk, com.au) is part of the suffix.
export function webSourceName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    const parts = host.split('.');
    // Only under a two-letter country TLD: "foo.com.dev" ends in a gTLD, so its
    // "com" is an ordinary label rather than half of a compound suffix.
    const secondLevelSuffix =
      parts.length >= 3 &&
      /^[a-z]{2}$/.test(parts[parts.length - 1]) &&
      /^(co|com|org|net|ac|gov|edu)$/.test(parts[parts.length - 2]);
    const label = parts[Math.max(0, parts.length - (secondLevelSuffix ? 3 : 2))];
    return label.charAt(0).toUpperCase() + label.slice(1);
  } catch {
    return url;
  }
}
