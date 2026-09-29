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

// The guidance is prose the model reads; only the names the host implements
// are a contract, so a rewording must not break this test but a renamed API must.
test('App guidance names the host APIs, attributes, and approved hosts the runtime provides', () => {
  const prompt = formatAppPrompt('/visualize compare renderer timings', 'create');

  assert.match(prompt, /^DROIDEX App request:\n\/visualize compare renderer timings\n/);
  assert.match(prompt, /fenced `app` block/);
  for (const name of [
    'data-droidex-app-root',
    'data-latex',
    'data-display',
    'window.droidex.renderMath',
    'window.droidex.renderAllMath',
    'window.droidex.createCanvas',
    'window.droidex.theme',
    'droidex:themechange',
    '--app-background',
    '--app-surface',
    '--app-foreground',
    '--app-muted',
    '--app-border',
    '--app-accent',
    'https://fonts.googleapis.com',
    'https://fonts.gstatic.com',
    'https://cdn.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
  ]) {
    assert.ok(prompt.includes(name), `guidance should name ${name}`);
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
