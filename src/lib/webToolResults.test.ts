import test from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeHtml, parseWebFetch, parseWebSearch, webSourceName } from './webToolResults';

const SAMPLE = `Web Search Results for: "electron auto update best practices 2026"

**Electron | Sentry for Electron**
   URL: https://docs.sentry.io/platforms/javascript/guides/electron/
\x20\x20\x20
   Learn how to manually set up Sentry in your Electron app and capture your first errors.

---

**GitHub - getsentry/sentry-electron: The official Sentry SDK for ...**
   URL: https://github.com/getsentry/sentry-electron
\x20\x20\x20
   The official Sentry SDK for Electron. Contribute to getsentry/sentry-electron development by creating an account on GitHub.
Found 2 results`;

test('looksLikeHtml detects raw HTML but not markdown prose', () => {
  assert.equal(looksLikeHtml('<!DOCTYPE html>\n<html><body>hi</body></html>'), true);
  assert.equal(
    looksLikeHtml(
      '<div class="a"><p>one</p><p>two</p><span>three</span><br/><hr/><b>x</b><i>y</i><u>z</u></div>',
    ),
    true,
  );
  assert.equal(
    looksLikeHtml('# Title\n\nSome **markdown** body with [a link](https://x.com).'),
    false,
  );
  assert.equal(looksLikeHtml('Plain text, no tags at all.'), false);
});

test('parseWebSearch extracts query, count and result blocks, and none from an empty search', () => {
  const { query, count, results } = parseWebSearch(SAMPLE);
  assert.equal(query, 'electron auto update best practices 2026');
  assert.equal(count, 2);
  assert.equal(results.length, 2);
  assert.equal(results[0].title, 'Electron | Sentry for Electron');
  assert.equal(results[0].url, 'https://docs.sentry.io/platforms/javascript/guides/electron/');
  assert.match(results[0].snippet, /manually set up Sentry/);
  assert.equal(results[1].url, 'https://github.com/getsentry/sentry-electron');

  const empty = parseWebSearch('Web Search Results for: "nothing here"\n\nNo results found.');
  assert.equal(empty.results.length, 0);
  assert.equal(empty.count, undefined);
});

test('parseWebFetch prefers the arg URL and a markdown title', () => {
  const page = parseWebFetch(
    '# Electron auto-update\n\nShip updates safely with differential releases.\n\nMore detail here.',
    'https://www.electronjs.org/docs/latest/tutorial/updates',
  );
  assert.equal(page.url, 'https://www.electronjs.org/docs/latest/tutorial/updates');
  assert.equal(page.title, 'Electron auto-update');
  assert.match(page.body, /Ship updates safely/);
  assert.ok(!page.body.startsWith('#'));
  assert.ok(page.chars > 20);
  assert.equal(page.truncatedChars, null);
});

test('parseWebFetch reads Title/URL lines as metadata only in the preamble and strips the truncation sentinel', () => {
  const truncated = parseWebFetch(
    'Title: Sentry for Electron\nURL: https://docs.sentry.io/platforms/javascript/guides/electron/\n\nLearn how to set up Sentry.\n\n[truncated 4096 chars]',
  );
  assert.equal(truncated.title, 'Sentry for Electron');
  assert.equal(truncated.url, 'https://docs.sentry.io/platforms/javascript/guides/electron/');
  assert.equal(truncated.body, 'Learn how to set up Sentry.');
  assert.equal(truncated.truncatedChars, 4096);

  const page = parseWebFetch(
    [
      'Title: Sentry for Electron',
      'URL: https://docs.sentry.io/platforms/javascript/guides/electron/',
      '',
      'Learn how to set up Sentry.',
      '',
      'Title: Advanced configuration',
      'URL: https://docs.sentry.io/advanced/',
      '',
      'More detail here.',
    ].join('\n'),
  );
  assert.equal(page.title, 'Sentry for Electron');
  // Body lines that later begin with Title:/URL: are content, not metadata —
  // they must survive in the preview.
  assert.ok(page.body.includes('Title: Advanced configuration'));
  assert.ok(page.body.includes('URL: https://docs.sentry.io/advanced/'));
});

test('parseWebFetch strips a first-line fallback title so it does not repeat in the body', () => {
  const page = parseWebFetch(
    'Electron Auto-Update Guide\n\nShip updates safely with differential releases.\n\nMore detail here.',
  );
  assert.equal(page.title, 'Electron Auto-Update Guide');
  assert.equal(page.body, 'Ship updates safely with differential releases.\n\nMore detail here.');
  // A preamble URL line is still read as the source.
  const withUrl = parseWebFetch('My Guide\nURL: https://example.com/guide\n\nBody text.');
  assert.equal(withUrl.title, 'My Guide');
  assert.equal(withUrl.url, 'https://example.com/guide');
  assert.equal(withUrl.body, 'Body text.');
});

test('parseWebFetch leaves an empty body when the page is only its title chrome', () => {
  // The title (a fallback first line, an h1, or Title/URL metadata) and the
  // source row are card chrome; restoring them as the body would render the
  // same text twice in the card.
  // [page, title, url]
  const cases: Array<[string, string, string | undefined]> = [
    ['Just A Title', 'Just A Title', undefined],
    ['Just A Title\nURL: https://example.com', 'Just A Title', 'https://example.com'],
    ['# Just A Heading', 'Just A Heading', undefined],
    ['Title: Some Page\nURL: https://example.com', 'Some Page', 'https://example.com'],
  ];
  for (const [text, title, url] of cases) {
    const page = parseWebFetch(text);
    assert.equal(page.title, title, text);
    if (url) assert.equal(page.url, url, text);
    assert.equal(page.body, '', text);
  }
});

test('webSourceName derives a capitalized registrable label', () => {
  assert.equal(webSourceName('https://www.theregister.com/2026/01/01/x'), 'Theregister');
  assert.equal(webSourceName('https://docs.sentry.io/platforms'), 'Sentry');
  assert.equal(webSourceName('not a url'), 'not a url');
  assert.equal(webSourceName('https://bbc.co.uk/news'), 'Bbc');
  // ".dev" is a gTLD, so the "com" in front of it is an ordinary label.
  assert.equal(webSourceName('https://foo.com.dev/x'), 'Com');
});
