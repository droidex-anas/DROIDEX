import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReport } from './canvasAgentReport.js';
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
