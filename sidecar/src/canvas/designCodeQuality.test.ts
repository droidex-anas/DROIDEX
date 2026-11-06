import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCodeQuality } from './designCodeQuality.js';
import { starterKit } from './designSystemImport.js';
import { AUTO_DESIGN_SYSTEM } from './presets/auto.js';
import type { DesignSystem } from './designSystems.js';
import type { CanvasDiagnostic, DesignSystemAdherence, SourceFiles } from './protocol.js';

const KIT: DesignSystem = { id: 'starter', version: 1, name: 'Starter', ...starterKit() };

function check(
  files: SourceFiles,
  system: DesignSystem = AUTO_DESIGN_SYSTEM,
  rule: DesignSystemAdherence = 'guide',
): CanvasDiagnostic[] {
  return checkCodeQuality(files, system, rule);
}

function places(diagnostics: CanvasDiagnostic[]): string[] {
  return diagnostics.map(({ code, file, line }) => `${code} ${file ?? ''}:${String(line ?? '')}`);
}

const CLEAN: SourceFiles = {
  'main.tsx': `import { useState } from 'react';
import { Row } from './Row';

const channels = [
  { id: 'push', label: 'Push' },
  { id: 'email', label: 'Email' },
];

export default function Settings() {
  const [wide, setWide] = useState(false);
  return (
    <main
      className="bg-[color:var(--ds-canvas)] text-[color:var(--ds-fg)]"
      style={{ width: wide ? 480 : 320 }}
    >
      <ul>
        {channels.map((channel) => (
          <Row key={channel.id} label={channel.label} onSelect={() => setWide((v) => !v)} />
        ))}
      </ul>
    </main>
  );
}
`,
  'Row.tsx': `export function Row({ label, onSelect }: { label: string; onSelect: () => void }) {
  return (
    <li className="w-[320px] rounded-[var(--ds-radius-md)] p-[var(--ds-space-2)]">
      <button onClick={onSelect}>{label}</button>
    </li>
  );
}
`,
};

test('a frame written to the brief reports nothing', () => {
  assert.deepEqual(check(CLEAN), []);
});

test('off asks for no findings at all', () => {
  const messy: SourceFiles = {
    'main.tsx': `import { useMemo } from 'react';
export default function App() {
  return <div className="p-[13px]" style={{ padding: 12 }}>Hey</div>;
}
`,
  };
  assert.deepEqual(check(messy, AUTO_DESIGN_SYSTEM, 'off'), []);
});

test('a source too large to check in a build gets no findings', () => {
  const rows = Array.from({ length: 8_000 }, (_, i) => `export const row${String(i)} = 'row';`);
  const files = {
    'main.tsx': `import { useMemo } from 'react';
export default function App() {
  return <p>Hey</p>;
}
`,
    'data.ts': rows.join('\n'),
  };
  assert.deepEqual(check(files), []);
});

test('imports, variables and parameters that are never read are named once per file', () => {
  const [finding, ...rest] = check({
    'main.tsx': `import { useMemo, useState } from 'react';
import { Bell, Moon } from 'lucide-react';

const LIMIT = 3;

export default function App({ dimmed }: { dimmed: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <button onClick={() => setOpen(true)}>{open ? <Bell /> : null}</button>
  );
}
`,
  });
  assert.deepEqual(rest, []);
  assert.equal(finding.code, 'code_quality_unused');
  assert.equal(finding.file, 'main.tsx');
  assert.equal(finding.line, 1);
  for (const name of ['useMemo (line 1)', 'Moon (line 2)', 'LIMIT (line 4)', 'dimmed (line 6)'])
    assert.ok(finding.message.includes(name), name);
  assert.ok(!finding.message.includes('useState'), 'used names stay out');
});

test('style={{}} is flagged for its static properties only, and once per file', () => {
  const findings = check({
    'main.tsx': `export default function App({ open, top }: { open: boolean; top: number }) {
  return (
    <div style={{ padding: 12, color: 'red', width: open ? 4 : 8, marginTop: top }}>
      <p style={{ left: 4 }}>Hey</p>
    </div>
  );
}
`,
  });
  assert.deepEqual(places(findings), ['code_quality_static_style main.tsx:3']);
  const { message } = findings[0];
  for (const property of ['padding', 'color', 'left'])
    assert.ok(message.includes(property), property);
  assert.ok(!message.includes('width'), 'a computed value belongs in style={{}}');
  assert.ok(!message.includes('marginTop'), 'a passed-in value is not a literal');
  assert.ok(message.includes('line 3') && message.includes('4'), 'both attributes are named');
});

test('a raw colour or scale value in a [..] class is named; tokens and layout sizes are fine', () => {
  const findings = check({
    'main.tsx': `export default function App() {
  return (
    <div className="p-[13px] text-[13px] w-[320px] bg-[#0f172a] rounded-[var(--ds-radius-md)] hover:bg-[color:var(--ds-raised)]">
      Hey
    </div>
  );
}
`,
    'styles.css': `.card {
  @apply m-[7px] bg-[color:var(--ds-surface)];
}
`,
  });
  assert.deepEqual(places(findings), [
    'code_quality_raw_value main.tsx:3',
    'code_quality_raw_value styles.css:2',
  ]);
  const [script, sheet] = findings;
  for (const utility of ['p-[13px]', 'text-[13px]', 'bg-[#0f172a]'])
    assert.ok(script.message.includes(utility), utility);
  for (const fine of ['w-[320px]', 'rounded-[var(--ds-radius-md)]', 'ds-raised'])
    assert.ok(!script.message.includes(fine), fine);
  assert.ok(sheet.message.includes('m-[7px]'));
});

test('under a kit the kit check owns raw values; this check stays out of the way', () => {
  const findings = check(
    {
      'main.tsx': `export default function App() {
  return <div className="text-[13px] bg-[#0f172a]">Hey</div>;
}
`,
    },
    KIT,
    'guide',
  );
  assert.deepEqual(findings, []);
});

test('three or more sibling blocks of one shape read as copied markup; two do not', () => {
  const row = (label: string) => `        <li className="row"><Bell /><span>${label}</span></li>`;
  const findings = check({
    'main.tsx': `import { Bell } from 'lucide-react';

export default function Channels() {
  return (
    <ul>
${row('Push')}
${row('Email')}
${row('Digest')}
    </ul>
  );
}
`,
    'Pair.tsx': `import { Bell } from 'lucide-react';

export function Pair() {
  return (
    <ul>
${row('Push')}
${row('Email')}
    </ul>
  );
}
`,
  });
  assert.deepEqual(places(findings), ['code_quality_repeated_markup main.tsx:6']);
  assert.match(findings[0].message, /3 sibling <li> blocks on lines 6-8/);
});

test('a file past 300 lines, or a component past 150, is asked to split', () => {
  const body = Array.from({ length: 155 }, (_, i) => `  const v${String(i)} = ${String(i)};`);
  const findings = check({
    'main.tsx': ['export default function App() {', ...body, '  return <p>Hey</p>;', '}'].join(
      '\n',
    ),
    'data.ts': Array.from(
      { length: 302 },
      (_, i) => `export const row${String(i)} = ${String(i)};`,
    ).join('\n'),
  }).filter((diagnostic) => diagnostic.code === 'code_quality_size');
  assert.deepEqual(places(findings), [
    'code_quality_size main.tsx:1',
    'code_quality_size data.ts:1',
  ]);
  assert.match(findings[0].message, /App is 158 lines/);
  assert.match(findings[1].message, /data\.ts is 302 lines/);
});
