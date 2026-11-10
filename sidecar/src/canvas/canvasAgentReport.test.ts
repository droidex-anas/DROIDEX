import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agentFrame, buildReport } from './canvasAgentReport.js';
import { AUTO_DESIGN_SYSTEM_REF } from './designSystems.js';
import type { CanvasDiagnostic, CanvasFrame } from './protocol.js';

function frame(diagnostics: CanvasDiagnostic[]): CanvasFrame {
  return {
    designId: 'design-1',
    name: 'Settings',
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'revision-1',
    designSystem: AUTO_DESIGN_SYSTEM_REF,
    variantOf: null,
    seededRevisionId: null,
    hidden: false,
    build: {
      status: 'ready',
      revisionId: 'revision-1',
      artifactId: 'artifact-1',
      elements: [],
      diagnostics,
      generation: 1,
    },
  };
}

test('a ready build separates bundle warnings, kit findings and code-quality notes', () => {
  const report = buildReport(
    frame([
      { code: 'css_warning', message: 'A bundle warning.' },
      { code: 'design_system_color', message: 'A kit finding.', file: 'main.tsx', line: 4 },
      { code: 'code_quality_unused', message: 'A code-quality note.', file: 'main.tsx', line: 2 },
    ]),
    null,
  );
  assert.equal(report.status, 'ready');
  if (report.status !== 'ready') return;
  assert.deepEqual(
    report.warnings?.map(({ code }) => code),
    ['css_warning'],
  );
  assert.deepEqual(
    report.designSystem?.diagnostics.map(({ code }) => code),
    ['design_system_color'],
  );
  assert.deepEqual(
    report.codeQuality?.diagnostics.map(({ code }) => code),
    ['code_quality_unused'],
  );
  assert.match(report.codeQuality?.next ?? '', /Code quality, not a build error/);
});

test('a build without notes has no code-quality section', () => {
  const report = buildReport(frame([]), null);
  assert.equal(report.status, 'ready');
  if (report.status !== 'ready') return;
  assert.equal(report.codeQuality, undefined);
  assert.equal(report.warnings, undefined);
  assert.equal(report.designSystem, undefined);
});

test('a kit finding names the rule in effect: Guide notes it on the built frame, Strict fails the build', () => {
  const finding = {
    code: 'design_system_color',
    message: 'A raw colour.',
    file: 'main.tsx',
    line: 4,
  };
  const guide = buildReport(frame([finding]), null);
  assert.equal(guide.status, 'ready');
  if (guide.status !== 'ready') return;
  assert.match(
    guide.designSystem?.next ?? '',
    /^Guide design-system rule: [^.]*user sees these as notes/,
  );

  const strict = buildReport(
    {
      ...frame([]),
      build: {
        status: 'failed',
        revisionId: 'revision-1',
        diagnostics: [finding],
        lastWorkingRevisionId: null,
        generation: 1,
      },
    },
    null,
  );
  assert.equal(strict.status, 'failed');
  assert.match(strict.next, /^Strict design-system rule: the frame did not build/);
  assert.match(
    strict.next,
    /Fix main\.tsx line 4 and write again with expectedRevisionId "revision-1"\.$/,
  );

  const broken = buildReport(
    {
      ...frame([]),
      build: {
        status: 'failed',
        revisionId: 'revision-1',
        diagnostics: [
          { code: 'syntax_error', message: 'Unexpected token', file: 'main.tsx', line: 3 },
        ],
        lastWorkingRevisionId: null,
        generation: 1,
      },
    },
    null,
  );
  assert.equal(
    broken.next,
    'Fix main.tsx line 3 and write again with expectedRevisionId "revision-1".',
  );
});

test('an agent sees a frame the user hid marked hidden, and a shown one unmarked', () => {
  assert.equal(agentFrame({ ...frame([]), hidden: true }, null).hidden, true);
  assert.equal('hidden' in agentFrame(frame([]), null), false);
});
