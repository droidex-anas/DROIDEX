import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown, MarkdownTree, markdownFenceOptions } from './Markdown';
import { SpecRenderer } from './SpecRenderer';

interface MarkdownProps {
  children: string;
  specMode?: boolean;
}

test('disabled generated content renders svg and app fences as escaped code', () => {
  const disabled = (source: string) =>
    renderToStaticMarkup(createElement(Markdown, { allowGeneratedContent: false }, source));

  const svg = disabled('```svg\n<svg onload="globalThis.pwned=true"></svg>\n```');
  assert.doesNotMatch(svg, /<svg[^>]*\sonload=/i);
  assert.match(svg, /&lt;svg onload=/);

  const app = disabled('```app\n<p>Untrusted preview content</p>\n```');
  assert.match(app, /&lt;p&gt;Untrusted preview content&lt;\/p&gt;/);
  assert.doesNotMatch(app, /aria-label="Play app"/);
});

test('generated SVG stays in image context in chat and spec previews', () => {
  const payload =
    '<svg xmlns="http://www.w3.org/2000/svg" onload="globalThis.pwned=true" viewBox="0 0 4 2"><title> Authored "<tspan>flow</tspan>" </title><desc>Input   to output</desc><rect width="4" height="2"/></svg>';
  const source = `\`\`\`svg\n${payload}\n\`\`\``;
  const previews = [
    createElement(Markdown, null, source),
    createElement(SpecRenderer, { content: source }),
  ];
  for (const preview of previews) {
    const html = renderToStaticMarkup(preview);
    assert.match(html, /<img[^>]*src="data:image\/svg\+xml;charset=utf-8,/);
    assert.match(html, /alt="Authored &quot;flow&quot;\. Input to output"/);
    assert.doesNotMatch(html, /\sonload=/);
  }
  assert.match(
    renderToStaticMarkup(createElement(SpecRenderer, { content: '```svg\n<svg/>\n```' })),
    /alt="SVG diagram"/,
  );
});

test('restored app fences start inline without a Play card; a cut-off one alerts alone', () => {
  const source = '```app\n<button onclick="document.body.dataset.ran=\'yes\'">Run</button>\n```';
  const html = renderToStaticMarkup(createElement(Markdown, null, source));

  assert.doesNotMatch(html, /aria-label="(?:Play|Stop) app"/);
  assert.match(html, />Starting interactive app</);

  // A cut-off message keeps its earlier complete App playable.
  const cutOff = [
    '```app',
    '<main>Complete</main>',
    '```',
    '',
    '```app',
    '<main>Cut off<script>const points = [',
  ].join('\n');
  const cutHtml = renderToStaticMarkup(createElement(Markdown, { cutOffAppBlocks: true }, cutOff));
  assert.equal(cutHtml.match(/>Starting interactive app</g)?.length, 1);
  assert.equal(cutHtml.match(/role="alert"/g)?.length, 1);
});

test('plain fenced blocks preserve preformatted multiline layout', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, null, '```\nfirst line\nsecond line\n```'),
  );

  assert.match(html, /<pre[^>]*>/);
  // A fence without a language is still a code card, not an inline pill on
  // every line, and it does not gain the parser's trailing newline.
  assert.match(html, /title="Copy"/);
  assert.match(html, /first line\nsecond line<\/code>/);
});

test('formatted spec headings keep a usable text slug', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, { specMode: true }, '## The `--app-surface` *color*'),
  );

  assert.match(html, /id="the-app-surface-color"/);
  assert.doesNotMatch(html, /id=""/);
});

test('a linked image renders one image control without a wrapping anchor', () => {
  const imageOnly = '[![Preview](https://x.test/a.png)](https://x.test/full)';
  const imageAndText = '[![Preview](https://x.test/a.png) full size](https://x.test/full)';
  for (const source of [imageOnly, imageAndText]) {
    const html = renderToStaticMarkup(createElement(Markdown, null, source));
    assert.match(html, /<button[^>]*title="View Preview"/, source);
    assert.doesNotMatch(html, /<a[^>]*href="https:\/\/x\.test\/full"/, source);
    // Link text beside the image still renders.
    if (source === imageAndText) assert.match(html, /full size/);
  }
});

test('each live App fence owns its own completion state', () => {
  const cases: { name: string; source: string; starting: number; building: number }[] = [
    {
      name: 'a complete fence before a streaming one',
      source: [
        '```app',
        '<main>Complete</main>',
        '```',
        '',
        '```app',
        '<main>Still streaming',
      ].join('\n'),
      starting: 1,
      building: 1,
    },
    {
      // Same completion state as react-markdown for an info-string title.
      name: 'an info-string title',
      source: '```app title="Latency explorer"\n<main>Still streaming',
      starting: 0,
      building: 1,
    },
    {
      // An uppercase fence is ordinary code and must not shift a later App.
      name: 'an uppercase fence before a streaming one',
      source: [
        '```App',
        '<main>Ordinary code</main>',
        '```',
        '',
        '```app',
        '<main>Still streaming',
      ].join('\n'),
      starting: 0,
      building: 1,
    },
    {
      name: 'a completed fence in a quote',
      source: ['> ```app', '> <main>Quoted app</main>', '> ```'].join('\n'),
      starting: 1,
      building: 0,
    },
    {
      name: 'a completed fence in a list',
      source: ['- ```app', '  <main>Listed app</main>', '  ```'].join('\n'),
      starting: 1,
      building: 0,
    },
    {
      name: 'a completed fence in a quoted list',
      source: ['- > ```app', '  > <main>Quoted list app</main>', '  > ```'].join('\n'),
      starting: 1,
      building: 0,
    },
    {
      // The fence scan is deliberately simpler than a full CommonMark parser, so a
      // fence nested deeper than it follows is missing from its list. An unfinished
      // one must still not be mistaken for a finished app and auto-played.
      name: 'a streaming fence nested past the fence scan',
      source: [
        '```app',
        '<main>Complete</main>',
        '```',
        '',
        '- item',
        '  - nested',
        '',
        '      ```app',
        '      <main>Still streaming',
      ].join('\n'),
      starting: 1,
      building: 1,
    },
  ];
  const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;

  for (const { name, source, starting, building } of cases) {
    const html = renderToStaticMarkup(createElement(Markdown, { buildingAppBlocks: true }, source));
    assert.equal(count(html, />Starting interactive app</g), starting, name);
    assert.equal(count(html, />Building interactive app</g), building, name);
    if (name.startsWith('an uppercase')) {
      assert.match(html, /&lt;main&gt;Ordinary code&lt;\/main&gt;/);
    }
  }
});

test('a streaming response keeps the same element types across renders', () => {
  // react-markdown uses each `components` entry as the JSX element type, so a
  // map rebuilt per render makes React remount the whole response on every
  // streamed token: App iframes reload, Mermaid diagrams restart, and anything
  // the reader is interacting with is thrown away.
  const renderMarkdown = (Markdown as unknown as { type: (props: MarkdownProps) => ReactElement })
    .type;
  const childOf = (element: ReactElement) => (element.props as { children: ReactElement }).children;
  const componentsFor = (props: MarkdownProps) => {
    const shell = renderMarkdown(props);
    const tree = childOf(shell);
    const renderedTree = (tree.type as (treeProps: unknown) => ReactElement)(tree.props);
    const markdown = childOf(renderedTree);
    return (markdown.props as { components: Record<string, unknown> }).components;
  };

  const source = '```app\n<main>Live app</main>\n```\n';
  const first = componentsFor({ children: source });
  const second = componentsFor({
    children: `${source}\nTrailing prose while the answer streams.`,
  });

  assert.equal(first, second);
  assert.equal(first.code, second.code);
  assert.equal(first.p, second.p);
  // Spec mode is a different presentation, and so a different stable map.
  assert.notEqual(first, componentsFor({ children: source, specMode: true }));
});

test('copy gracefully declines when the Clipboard API is unavailable', async () => {
  const markdownCode = (await import('./MarkdownCode')) as unknown as {
    copyMarkdownCode?: (
      clipboard: Pick<Clipboard, 'writeText'> | undefined,
      text: string,
    ) => Promise<boolean>;
  };
  assert.equal(await markdownCode.copyMarkdownCode?.(undefined, 'sample'), false);
});

test('small JSON fences keep token highlighting and large ones stay plain', async () => {
  const { JSON_HIGHLIGHT_MAX_CHARS } = await import('./MarkdownCode');
  const small = '```json\n{"accent": true, "count": 3, "name": "droid"}\n```';
  const largeObject = Object.fromEntries(
    Array.from({ length: 1200 }, (_, index) => [`k${String(index)}`, index]),
  );
  const large = `\`\`\`json\n${JSON.stringify(largeObject)}\n\`\`\``;
  assert.ok(JSON.stringify(largeObject).length > JSON_HIGHLIGHT_MAX_CHARS);

  const smallHtml = renderToStaticMarkup(createElement(Markdown, null, small));
  const largeHtml = renderToStaticMarkup(createElement(Markdown, null, large));
  // Keys read by accent, string values by green.
  assert.match(smallHtml, /--droid-accent\)">&quot;accent&quot;/);
  assert.match(smallHtml, /--droid-green\)">&quot;droid&quot;/);
  assert.doesNotMatch(largeHtml, /--droid-green/);
  assert.match(largeHtml, /k1199/);
});

test('GFM task lists render as checkbox rows without bullet markers', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, null, ['- [x] done', '- [ ] open'].join('\n')),
  );

  assert.match(html, /<input[^>]*type="checkbox"[^>]*checked/);
  assert.match(html, /<li[^>]*list-none/);
  assert.doesNotMatch(html, /<li[^>]*list-disc/);
});

test('breaks mode keeps single newlines from typed text as visible breaks', () => {
  const source = 'first line\nsecond line';
  const render = (breaks: boolean) =>
    renderToStaticMarkup(
      createElement(
        MarkdownTree,
        { specMode: false, fenceOptions: markdownFenceOptions(source, {}), breaks },
        source,
      ),
    );

  assert.match(render(true), /<br\/>/);
  assert.doesNotMatch(render(false), /<br\/>/);
});

// Shortening an arbitrary link would hide where it goes.
test('a bare non-GitHub URL still shows its full address', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, null, 'see https://techcrunch.com/2026/09/08/muse'),
  );

  assert.match(html, /techcrunch\.com\/2026\/09\/08\/muse<\/span>/);
});
