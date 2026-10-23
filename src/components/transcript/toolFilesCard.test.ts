import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TranscriptEvent } from '../../types/bridge';
import { renderToolEvents } from './rows';

// Correlated call/result pairs so the group renderer can fold each result
// into its call instead of leaking it as raw activity.
function callEvent(id: string, toolName: string, toolArgs: unknown): TranscriptEvent {
  return {
    id,
    appSessionId: 's',
    sourceSessionId: 's',
    role: 'primary',
    ts: 0,
    kind: 'tool_call',
    toolUseId: id,
    toolName,
    toolArgs,
  };
}

function resultEvent(id: string, text: string, isError = false): TranscriptEvent {
  return {
    id: `${id}-result`,
    appSessionId: 's',
    sourceSessionId: 's',
    role: 'primary',
    ts: 0,
    kind: 'tool_result',
    toolUseId: id,
    text,
    ...(isError ? { isError } : {}),
  };
}

// File rows are dispatched by renderToolEvents, so these render through it.
function renderGroup(events: TranscriptEvent[], live = false, canOpenFiles = true): string {
  const onOpenReviewFile = canOpenFiles ? () => {} : undefined;
  return renderToStaticMarkup(
    createElement('div', null, ...renderToolEvents(events, live, false, onOpenReviewFile)),
  );
}

const GREP_CALL = callEvent('g', 'Grep', { pattern: 'density' });
const READ_CALL = callEvent('r', 'Read', { file_path: 'src/app.tsx' });
const LS_CALL = callEvent('l', 'LS', { path: 'src/lib' });

const SIX_FILE_OUTPUT = [
  'src/a.ts:1:const density = 1;',
  'src/b.ts:2:  density,',
  'src/c.tsx:3:  density,',
  'src/d.md:4: density',
  'src/e.json:5:  "density",',
  'src/f.ts:6:  density,',
].join('\n');

test('a search chips the files it found, folding the rest behind a count chip', () => {
  const html = renderGroup([GREP_CALL, resultEvent('g', SIX_FILE_OUTPUT)]);
  for (const name of ['a.ts', 'b.ts', 'c.tsx', 'd.md']) assert.match(html, new RegExp(`>${name}<`));
  // The overflow unfolds on click, so the folded chips are not in the markup.
  assert.doesNotMatch(html, />e\.json</);
  assert.match(
    html,
    /aria-expanded="false"[^>]*rounded-full[^>]*>\+(?:<!-- -->)?2(?:<!-- -->)? more</,
  );
  assert.doesNotMatch(html, /Show less/);
});

test('a chip opens its file in Review when the transcript provides a handler', () => {
  const events = [GREP_CALL, resultEvent('g', 'src/a.ts:1:x')];
  assert.match(renderGroup(events), /<button[^>]+title="Open src\/a\.ts in Review"/);
  assert.doesNotMatch(renderGroup(events, false, false), /Open src\/a\.ts in Review/);
});

test('a failed search shows no chips, and a live one shimmers its verb', () => {
  const failed = renderGroup([GREP_CALL, resultEvent('g', 'src/a.ts:1:x', true)]);
  assert.doesNotMatch(failed, />a\.ts</);
  // Without a body to hide in, the failure surfaces inline next to the row.
  assert.match(failed, /bg-danger-soft/);
  assert.match(failed, />Error</);
  const live = renderGroup([GREP_CALL], true);
  assert.match(live, /shimmer-text[^>]*>Searching</);
  assert.doesNotMatch(live, /rounded-full bg-elevated/);
});

test('a successful read has no raw args or output, and chips its file once', () => {
  const html = renderGroup([READ_CALL, resultEvent('r', 'export function App() {}')]);
  assert.doesNotMatch(html, /file_path/);
  assert.doesNotMatch(html, /export function App/);
  assert.doesNotMatch(html, /aria-expanded/);
  // Exactly one link to the file: the chip, not the row's old path target.
  assert.equal(html.match(/Open src\/app\.tsx in Review/g)?.length, 1);
  assert.match(html, />app\.tsx</);
});

test('a read in flight chips the file at once and shimmers it until it lands', () => {
  const live = renderGroup([READ_CALL], true);
  assert.match(live, /shimmer-text[^>]*>Reading</);
  assert.match(live, /chip-enter/);
  assert.match(live, /shimmer-text[^>]*>app\.tsx</);
  // History renders still: no entrance, no shimmer.
  const settled = renderGroup([READ_CALL, resultEvent('r', '// app')]);
  assert.doesNotMatch(settled, /chip-enter|shimmer-text/);
});

test('a listing keeps its directory on the row and chips the entries', () => {
  const html = renderGroup([LS_CALL, resultEvent('l', 'src/lib/a.ts\nsrc/lib/b.ts')]);
  // The directory target stays on the row as the (single) path link…
  assert.equal(html.match(/Open src\/lib in Review/g)?.length, 1);
  // …never a chip, while the listed files become chips.
  assert.match(html, /title="Open src\/lib\/a\.ts in Review"/);
  assert.match(html, /title="Open src\/lib\/b\.ts in Review"/);
  assert.doesNotMatch(html, /title="Open src\/lib in Review"[^>]*rounded-full/);
});

test('a read of a path without a file name stays a plain row', () => {
  const html = renderGroup([
    callEvent('r', 'Read', { file_path: 'src/components' }),
    resultEvent('r', ''),
  ]);
  assert.match(html, />components</);
  assert.doesNotMatch(html, /rounded-full bg-elevated/);
});
/* ── A burst of consecutive reads/searches renders as one merged row. ── */

const READ_BURST: TranscriptEvent[] = [
  callEvent('r1', 'Read', { file_path: 'src/main.tsx' }),
  callEvent('r2', 'Read', { file_path: 'src/lib/store.ts' }),
  callEvent('r3', 'Read', { file_path: 'src/lib/themeTokens.ts' }),
  resultEvent('r1', '// main'),
  resultEvent('r2', '// store'),
  resultEvent('r3', '// tokens'),
];

test('a burst of reads merges into a single "Read N files" row', () => {
  const html = renderGroup(READ_BURST);
  // One verb for the whole burst, with the count as its target…
  assert.equal(html.match(/>Read</g)?.length, 1);
  assert.match(html, />3 files</);
  // …and every file pooled into the chip rail, once each.
  for (const name of ['main.tsx', 'store.ts', 'themeTokens.ts']) {
    assert.equal(html.match(new RegExp(`>${name}<`, 'g'))?.length, 1);
  }
  // The files' contents never leak into the transcript.
  assert.doesNotMatch(html, /\/\/ store/);
});

test('re-reads of one file count the file, not the calls', () => {
  const html = renderGroup([
    callEvent('r1', 'Read', { file_path: 'src/big.ts', limit: 200 }),
    callEvent('r2', 'Read', { file_path: 'src/big.ts', offset: 200, limit: 200 }),
    resultEvent('r1', '// part 1'),
    resultEvent('r2', '// part 2'),
  ]);
  assert.match(html, />1 file</);
  assert.equal(html.match(/>big\.ts</g)?.length, 1);
});

test('the merged rail folds long bursts behind a count', () => {
  const events = ['a.ts', 'b.ts', 'c.ts', 'd.ts', 'e.ts', 'f.ts'].flatMap((name, i) => [
    callEvent(`r${String(i)}`, 'Read', { file_path: `src/${name}` }),
  ]);
  const html = renderGroup(events);
  assert.match(html, />6 files</);
  assert.match(html, />d\.ts</);
  assert.doesNotMatch(html, />e\.ts</);
  assert.match(html, /\+(?:<!-- -->)?2(?:<!-- -->)? more/);
});

test('a mixed burst of reads and searches reads as one exploration', () => {
  const html = renderGroup([
    callEvent('r1', 'Read', { file_path: 'src/app.tsx' }),
    callEvent('g1', 'Grep', { pattern: 'density' }),
    resultEvent('r1', '// app'),
    resultEvent('g1', 'src/a.ts:1:x\nsrc/b.ts:2:y'),
  ]);
  assert.match(html, />Explored</);
  assert.match(html, />3 files</);
  for (const name of ['app.tsx', 'a.ts', 'b.ts']) assert.match(html, new RegExp(`>${name}<`));
});

test('a burst of searches keeps the patterns as its target', () => {
  const html = renderGroup([
    callEvent('g1', 'Grep', { pattern: 'density' }),
    callEvent('g2', 'Grep', { pattern: 'config' }),
    resultEvent('g1', 'src/a.ts:1:x'),
    resultEvent('g2', 'src/b.ts:2:y'),
  ]);
  assert.equal(html.match(/>Searched</g)?.length, 1);
  assert.match(html, />density, config</);
  assert.match(html, />a\.ts</);
  assert.match(html, />b\.ts</);
});

test('a failed call in a burst surfaces its error inline and keeps the other chips', () => {
  const html = renderGroup([
    callEvent('r1', 'Read', { file_path: 'src/main.tsx' }),
    callEvent('r2', 'Read', { file_path: 'src/lib/store.ts' }),
    resultEvent('r1', '// main'),
    resultEvent('r2', 'EACCES: permission denied', true),
  ]);
  assert.match(html, /bg-danger-soft/);
  assert.match(html, /EACCES: permission denied/);
  assert.match(html, />Error</);
  for (const name of ['main.tsx', 'store.ts']) assert.match(html, new RegExp(`>${name}<`));
});

test('a live burst shimmers its progressive verb until every call settles', () => {
  const html = renderGroup(
    [
      callEvent('r1', 'Read', { file_path: 'src/main.tsx' }),
      callEvent('r2', 'Read', { file_path: 'src/lib/store.ts' }),
      resultEvent('r1', '// main'),
    ],
    true,
  );
  assert.match(html, /shimmer-text[^>]*>Reading</);
  // Chips from the settled call and the in-flight target are already up.
  assert.match(html, />main\.tsx</);
  assert.match(html, />store\.ts</);
});

test('other tool calls break a burst into separate rows', () => {
  const html = renderGroup([
    callEvent('r1', 'Read', { file_path: 'src/main.tsx' }),
    resultEvent('r1', '// main'),
    callEvent('x1', 'Bash', { command: 'npm test' }),
    resultEvent('x1', 'ok'),
    callEvent('r2', 'Read', { file_path: 'src/lib/store.ts' }),
    resultEvent('r2', '// store'),
  ]);
  // No merged label: each read renders on its own, the command between them.
  assert.doesNotMatch(html, /files</);
  assert.equal(html.match(/>Read</g)?.length, 2);
  assert.match(html, />npm test</);
});
