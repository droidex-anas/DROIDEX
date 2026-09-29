import assert from 'node:assert/strict';
import test from 'node:test';

import {
  appPromptDisplayFromText,
  formatAppPrompt,
  formatAppRepairPrompt,
  hasAppFence,
} from './appPrompt.js';

test('hasAppFence recognizes the App answer shape the guidance asks for', () => {
  assert.equal(hasAppFence('Here it is.\n\n```app\n<main></main>\n```'), true);
  // Streaming or replay can hand over an answer whose fence is still open.
  assert.equal(hasAppFence('Here it is.\n\n```app\n<main>'), true);
  assert.equal(hasAppFence('```app\n<main></main>\n```'), true);
  assert.equal(hasAppFence('~~~~app\nbody'), true);
  assert.equal(hasAppFence('> ```app\n> <main></main>'), true);
  assert.equal(hasAppFence('- ```app\n  <main></main>'), true);
  // The renderer's scanner splits lines on \r?\n and strips any run of
  // blockquote or list prefixes, so the probe has to reach those shapes too.
  assert.equal(hasAppFence('Here it is.\r\n\r\n```app\r\n<main></main>\r\n```'), true);
  assert.equal(hasAppFence('- > ```app\n  > <main></main>'), true);
  assert.equal(hasAppFence('>\t```app\n>\t<main></main>'), true);
  assert.equal(hasAppFence('```app title=lab\n<main></main>\n```'), true);

  assert.equal(hasAppFence('```ts\nconst app = 1;\n```'), false);
  assert.equal(hasAppFence('```application\nnot an app fence\n```'), false);
  assert.equal(hasAppFence('the app fence lives inside prose ```app``` inline'), false);
  assert.equal(hasAppFence('no fences here at all'), false);
});

test('formatAppPrompt keeps the request recoverable and adds broad internal App guidance', () => {
  const prompt = formatAppPrompt('/visualize compare renderer timings', 'create');

  assert.match(prompt, /^DROIDEX App request:/);
  assert.match(prompt, /\/visualize compare renderer timings/);
  assert.match(prompt, /chart, diagram, timeline, calculator, simulator/);
  assert.match(prompt, /fenced `app` block/);
  assert.match(prompt, /--app-background/);
  assert.match(prompt, /transparent chat canvas/);
  assert.match(prompt, /transparent by default/);
  assert.match(prompt, /invisible layout container, not a card/);
  assert.match(prompt, /chat background shows through the gaps/);
  assert.match(prompt, /multiple independent sections/);
  assert.match(prompt, /Do not add a whole-App background or enclosing card unless/);
  assert.match(prompt, /Style individual sections/);
  assert.match(prompt, /Avoid accidental hard black or white page slabs/);
  assert.doesNotMatch(prompt, /keep that region transparent and unframed/);
  assert.match(prompt, /data-droidex-app-root/);
  assert.match(prompt, /no outer max-width or page padding/);
  assert.match(prompt, /host preserves author padding, radius, and shadows/);
  assert.match(prompt, /data-latex/);
  assert.match(prompt, /window\.droidex\.renderMath/);
  assert.match(prompt, /responsive SVG/);
  assert.match(prompt, /bar, line, area, scatter, bubble/);
  assert.match(prompt, /mixed views/);
  assert.match(prompt, /color-blind-safe/);
  assert.match(prompt, /palette or series-color controls/);
  assert.match(prompt, /illustrations, annotated processes, infographics/);
  assert.match(prompt, /visual, inspector, controls, and explanation/);
  assert.match(prompt, /hover, click, touch, and keyboard/);
  assert.match(prompt, /Never clip axis titles, tick labels, legends, or annotations/);
  assert.match(prompt, /wireframes/);
  assert.match(prompt, /do not request arbitrary APIs, localhost services, or local files/);
  assert.match(prompt, /verify that every inline script parses/);
  assert.match(prompt, /SVG or Canvas initialization runs without errors/);
});

test('App guidance allows approved fonts and components without promising desktop access', () => {
  for (const mode of ['create', 'followup'] as const) {
    const prompt = formatAppPrompt('Build a dashboard with custom fonts and cards', mode);
    assert.match(prompt, /https:\/\/fonts\.googleapis\.com/);
    assert.match(prompt, /https:\/\/fonts\.gstatic\.com/);
    assert.match(prompt, /display=swap/);
    assert.match(prompt, /Declare exactly the family you load/);
    assert.match(prompt, /tabular-nums, not a monospace font/);
    assert.match(prompt, /https:\/\/cdn\.jsdelivr\.net/);
    assert.match(prompt, /https:\/\/cdnjs\.cloudflare\.com/);
    assert.match(prompt, /Pin package versions/);
    assert.match(prompt, /crossorigin="anonymous"/);
    assert.match(prompt, /other network destinations are blocked/);
    assert.match(prompt, /useful if an external asset fails/);
    assert.match(prompt, /never put private chat data or credentials/);
    assert.match(prompt, /no nested frames, storage, popups, parent-document access/);
    assert.match(prompt, /Do not use eval, new Function/);
    assert.doesNotMatch(prompt, /Do not use network requests, external libraries/);
  }
});

test('App guidance documents the live local drawing contract and its lifecycle', () => {
  for (const mode of ['create', 'followup'] as const) {
    const prompt = formatAppPrompt('Chart the results', mode);
    assert.match(
      prompt,
      /window\.droidex\.createCanvas\("#plot", \(\{ context, width, height, theme \}\)/,
    );
    assert.match(prompt, /plot\.redraw\(\)/);
    assert.match(prompt, /plot\.dispose\(\)/);
    assert.match(prompt, /window\.droidex\.theme/);
    assert.match(prompt, /droidex:themechange.*event\.detail/);
    assert.match(prompt, /ephemeral across virtualizer remounts/);
    assert.match(prompt, /do not use vh sizing or min-height: 100vh/);
    assert.match(prompt, /keyboard-accessible/);
    assert.match(prompt, /prefers-reduced-motion/);
    assert.match(prompt, /do not use endless animation loops or polling/);
    assert.match(prompt, /pagehide/);
  }
});

test('App guidance offers math and visualization tools that fit the sandbox', () => {
  for (const mode of ['create', 'followup'] as const) {
    const prompt = formatAppPrompt('Explain the equations with charts and a flowchart', mode);
    assert.match(prompt, /local KaTeX rendering, with no CDN required/);
    assert.match(prompt, /window\.droidex\.renderAllMath\(container\)/);
    assert.match(prompt, /String\.raw`\\frac\{a\}\{b\}`/);
    assert.match(prompt, /not full LaTeX documents or TikZ/);
    assert.match(prompt, /Chart\.js/);
    assert.match(prompt, /Apache ECharts/);
    assert.match(prompt, /D3 for custom scales/);
    assert.match(prompt, /Avoid d3\.csvParse and d3\.tsvParse/);
    assert.match(prompt, /Mermaid for flowcharts/);
    assert.match(prompt, /securityLevel: "strict"/);
    assert.match(prompt, /do not attach window\.droidex\.createCanvas to a canvas already owned/);
    assert.match(prompt, /Disconnect ResizeObservers/);
    assert.match(prompt, /fallback on failure/);
    assert.doesNotMatch(prompt, /Build standard charts directly/);
  }
});

test('appPromptDisplayFromText reveals only what the user typed', () => {
  const prompt = formatAppPrompt('/visualize compare renderer timings', 'create');

  assert.equal(appPromptDisplayFromText(prompt), '/visualize compare renderer timings');
  assert.equal(appPromptDisplayFromText('ordinary prompt'), null);
});

test('an Auto-fix request carries the exact source but displays only the request and error', () => {
  const source = '<main><script>document.querySelector("#missing").value;</script></main>';
  const error = "Cannot read properties of null (reading 'value')";
  const prompt = formatAppRepairPrompt(error, source);

  assert.ok(prompt.includes(JSON.stringify({ error, source })));
  assert.match(prompt, /one complete corrected app block/);
  assert.equal(appPromptDisplayFromText(prompt), `Auto-fix this visualization.\n\nError: ${error}`);
});

test('a conversational App follow-up can revise the existing block without forcing one', () => {
  const prompt = formatAppPrompt('the hover interaction is not working, fix it', 'followup');

  assert.match(prompt, /chat already contains an interactive App/i);
  assert.match(prompt, /return a complete revised fenced `app` block/i);
  assert.match(prompt, /otherwise respond normally/i);
  assert.match(prompt, /the hover interaction is not working, fix it/);
});

test('explicit creation survives skill and file composition before sidecar formatting', () => {
  const composed = '/data-analysis /visualize compare the attached timings\n\n@timings.csv';
  const prompt = formatAppPrompt(composed, 'create');

  assert.match(prompt, /Build the most useful interactive in-chat App/);
  assert.doesNotMatch(prompt, /chat already contains an interactive App/i);
});
