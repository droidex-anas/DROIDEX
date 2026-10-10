import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { CompileFailedError, CompilerWorker } from './compiler.js';
import { checkDesignSystemAdherence } from './designSystemAdherence.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import type { CanvasDiagnostic, SourceFiles } from './protocol.js';
import { compileInput } from '../testing/canvasCompilerSupport.js';

const ON_KIT: SourceFiles = {
  'main.tsx': `import { LineChart, Line } from 'recharts';
import { Button, Card } from '@droidex/design-system';
import './styles.css';

const points = [{ label: 'Order #1042', value: 3 }];

export default function Report() {
  return (
    <Card className="flex flex-col gap-3 bg-[color:var(--ds-raised)]">
      <h1 className="text-[color:var(--ds-fg-muted)] font-[family-name:var(--ds-font-heading)]">Orders</h1>
      <LineChart width={320} height={120} data={points}>
        <Line dataKey="value" stroke="var(--ds-accent)" />
      </LineChart>
      <Button style={{ color: 'var(--ds-accent-fg)' }}>Export</Button>
    </Card>
  );
}
`,
  'styles.css': `.report-title {
  color: var(--ds-fg);
  font-family: var(--ds-font-sans), sans-serif;
  box-shadow: var(--ds-shadow-sm);
}
`,
};

const STRAYING: SourceFiles = {
  'main.tsx': `import { Card } from '@droidex/design-system';
import './styles.css';

export default function Report() {
  return (
    <Card className="bg-slate-900 data-[state=open]:bg-slate-800">
      <h1 className="text-[#e2e8f0] font-serif">Orders</h1>
      <svg><path stroke="#4f6fbe" /></svg>
      <p style={{ backgroundColor: 'white' }}>Order #1042</p>
    </Card>
  );
}
`,
  'styles.css': `:root {
  --ds-accent: #d9480f;
}
.report-title {
  color: rgb(15 23 42);
  font-family: Georgia, serif;
}
`,
};

function check(files: SourceFiles, rule: 'off' | 'guide' | 'strict' = 'guide') {
  return checkDesignSystemAdherence(files, DROIDEX_DESIGN_SYSTEM, rule);
}

function places(diagnostics: CanvasDiagnostic[]): string[] {
  return diagnostics.map(({ code, file, line }) => `${code} ${file ?? ''}:${String(line ?? '')}`);
}

test('a design built from kit primitives, tokens and fonts reports nothing', () => {
  assert.deepEqual(check(ON_KIT), { status: 'passed', diagnostics: [] });
});

test('hard-coded colours and fonts are reported by file and line, an override once as a note', () => {
  const result = check(STRAYING);
  assert.equal(result.status, 'passed');
  assert.deepEqual(places(result.diagnostics), [
    'design_system_color main.tsx:6',
    'design_system_color main.tsx:6',
    'design_system_color main.tsx:7',
    'design_system_font main.tsx:7',
    'design_system_color main.tsx:8',
    'design_system_color main.tsx:9',
    'design_system_color styles.css:5',
    'design_system_font styles.css:6',
    'design_system_override :',
  ]);
  const [palette, hover, arbitrary] = result.diagnostics;
  assert.match(
    palette.message,
    /^bg-slate-900 is a hard-coded colour.*bg-\[color:var\(--ds-surface\)\]/,
  );
  assert.match(hover.message, /^bg-slate-800 /, 'a bracketed variant is stripped');
  assert.match(arbitrary.message, /^text-\[#e2e8f0\] .*text-\[color:var\(--ds-fg\)\]/);
  assert.match(result.diagnostics[7].message, /"Georgia".*var\(--ds-font-sans\)/);
  assert.match(result.diagnostics[8].message, /--ds-accent\. They stay as deliberate overrides/);
});

test('a design that uses nothing from the kit says which primitives it offers', () => {
  const result = check({ 'main.tsx': 'export default () => <button>Go</button>;\n' });
  assert.deepEqual(result.diagnostics, [
    {
      code: 'design_system_unused',
      message:
        "The design imports nothing from @droidex/design-system. Build its controls from the kit's primitives (Button, Card, Badge, Input, Tabs, Dialog) so their states and tokens apply.",
      file: 'main.tsx',
    },
  ]);
});

test('strict fails on what guide reports, keeping overrides out of it, and off checks nothing', () => {
  const strict = check(STRAYING, 'strict');
  assert.equal(strict.status, 'failed');
  assert.deepEqual(
    places(strict.diagnostics),
    places(check(STRAYING).diagnostics).filter(
      (place) => !place.startsWith('design_system_override'),
    ),
  );
  const overridden = check({ ...ON_KIT, 'theme.css': ':root { --ds-accent: #d9480f; }' }, 'strict');
  assert.deepEqual(overridden.status, 'passed');
  assert.deepEqual(places(overridden.diagnostics), ['design_system_override :']);
  assert.deepEqual(check(STRAYING, 'off'), { status: 'passed', diagnostics: [] });
});

const worker = new CompilerWorker();
after(() => worker.terminate());

test('the compiler fails a straying build under strict and builds it with notes under guide', async () => {
  const guided = await worker.compile(
    compileInput(STRAYING, 'guide'),
    new AbortController().signal,
  );
  assert.deepEqual(places(guided.diagnostics), places(check(STRAYING).diagnostics));

  await assert.rejects(
    worker.compile(compileInput(STRAYING, 'strict'), new AbortController().signal),
    (error) => {
      assert.ok(error instanceof CompileFailedError);
      assert.deepEqual(places(error.diagnostics), places(check(STRAYING, 'strict').diagnostics));
      return true;
    },
  );
});
