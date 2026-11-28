import assert from 'node:assert/strict';
import { text } from 'node:stream/consumers';
import test from 'node:test';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { prerenderToNodeStream } from 'react-dom/static';
import { Markdown, MarkdownTree, markdownFenceOptions } from './Markdown';
import { SpecRenderer } from './SpecRenderer';
import { resetMarkdownOutputCacheForTest } from '../lib/markdownOutputCache';

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
  // A fence without a language is still a code card, not inline code on
  // every line, and it does not gain the parser's trailing newline.
  assert.match(html, />Copy<\/span><\/button>/);
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
  // the reader is interacting with is thrown away. The output tree carries
  // those types, so type identity across two renders is the invariant.
  const typesIn = (node: ReactNode, types: unknown[] = []): unknown[] => {
    if (Array.isArray(node)) {
      for (const child of node) typesIn(child, types);
      return types;
    }
    if (!isValidElement(node)) return types;
    types.push(node.type);
    return typesIn((node.props as { children?: ReactNode }).children, types);
  };
  const renderTree = (source: string, specMode = false) =>
    MarkdownTree({
      children: source,
      specMode,
      fenceOptions: markdownFenceOptions(source, {
        allowGeneratedContent: true,
        buildingAppBlocks: true,
        cutOffAppBlocks: false,
      }),
    });

  const source = '```app\n<main>Live app</main>\n```\n\nA paragraph with `inline code`.';
  const first = typesIn(renderTree(source)).filter((type) => typeof type === 'function');
  const second = typesIn(
    renderTree(`${source}\n\nTrailing prose while the answer streams.`),
  ).filter((type) => typeof type === 'function');

  assert.ok(first.length > 0);
  // Depth-first order is document order, so the prefix covers the shared head:
  // the same fence, paragraph and inline code types serve both renders.
  assert.deepEqual(second.slice(0, first.length), first);
  // Spec mode is a different presentation, and so a different stable map.
  const spec = typesIn(renderTree(source, true)).filter((type) => typeof type === 'function');
  assert.notEqual(spec[0], first[0]);
});

test('settled rows share one output tree without baking in per-row fence state', () => {
  // The cache stores the parsed tree, but building/cut-off/generated-content
  // state is per-row context read at render time: whichever row populates the
  // entry must never decide how another row with the same source renders.
  const source = '```app\n<main>partial';
  resetMarkdownOutputCacheForTest();
  const building = renderToStaticMarkup(
    createElement(Markdown, { buildingAppBlocks: true }, source),
  );
  const settled = renderToStaticMarkup(createElement(Markdown, null, source));

  assert.match(building, /Building interactive app/);
  assert.doesNotMatch(settled, /Building interactive app/);
  assert.match(settled, /role="alert"/);

  // Opposite order over a cold cache: whichever row populates the entry first
  // must never decide how the other renders.
  resetMarkdownOutputCacheForTest();
  assert.equal(renderToStaticMarkup(createElement(Markdown, null, source)), settled);
  assert.equal(
    renderToStaticMarkup(createElement(Markdown, { buildingAppBlocks: true }, source)),
    building,
  );

  const generatedOff = renderToStaticMarkup(
    createElement(Markdown, { allowGeneratedContent: false }, '```app\n<p>x</p>\n```'),
  );
  assert.match(generatedOff, /&lt;p&gt;x/);
  assert.match(
    renderToStaticMarkup(createElement(Markdown, null, '```app\n<p>x</p>\n```')),
    />Starting interactive app</,
  );
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
  const { HIGHLIGHT_MAX_CHARS } = await import('./MarkdownCode');
  const small = '```json\n{"accent": true, "count": 3, "name": "droid"}\n```';
  const largeObject = Object.fromEntries(
    Array.from({ length: 1200 }, (_, index) => [`k${String(index)}`, index]),
  );
  const large = `\`\`\`json\n${JSON.stringify(largeObject)}\n\`\`\``;
  assert.ok(JSON.stringify(largeObject).length > HIGHLIGHT_MAX_CHARS);

  const smallHtml = renderToStaticMarkup(createElement(Markdown, null, small));
  const largeHtml = renderToStaticMarkup(createElement(Markdown, null, large));
  // Keys and string values take their own code tokens.
  assert.match(smallHtml, /--code-function\)">&quot;accent&quot;/);
  assert.match(smallHtml, /--code-string\)">&quot;droid&quot;/);
  assert.doesNotMatch(largeHtml, /--code-string/);
  assert.match(largeHtml, /k1199/);
});

test('fences in a language the highlighter knows render as tokens', async () => {
  const { prelude } = await prerenderToNodeStream(
    createElement(Markdown, null, '```ts\nconst answer = "droid";\n\nexport { answer };\n```'),
  );
  const html = await text(prelude);

  assert.match(html, /--code-keyword\)">const</);
  assert.match(html, /--code-string\)">&quot;droid&quot;/);
  // Selecting the card copies its text: blank lines must not double.
  const codeText = /<code[^>]*>([\s\S]*?)<\/code>/.exec(html)?.[1].replace(/<[^>]+>/g, '');
  assert.equal(codeText, 'const answer = &quot;droid&quot;;\n\nexport { answer };');
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

// A command backticked word by word would otherwise draw a chip per word.
test('inline code spans separated only by spaces render as one span', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, null, 'run `git` `fetch` `origin` then open `src/App.tsx` `docs/a.md`'),
  );
  const spans = [...html.matchAll(/<code[^>]*>([^<]*)<\/code>/g)].map((match) => match[1]);

  assert.deepEqual(spans, ['git fetch origin', 'src/App.tsx', 'docs/a.md']);
});

// Shortening an arbitrary link would hide where it goes.
test('a bare non-GitHub URL still shows its full address', () => {
  const html = renderToStaticMarkup(
    createElement(Markdown, null, 'see https://techcrunch.com/2026/09/08/muse'),
  );

  assert.match(html, /techcrunch\.com\/2026\/09\/08\/muse<\/span>/);
});
