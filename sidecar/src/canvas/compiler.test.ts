import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import {
  CompileCancelledError,
  CompileFailedError,
  CompilerUnavailableError,
  CompilerWorker,
  type CompileInput,
  type CompiledDesign,
} from './compiler.js';
import { DEFAULT_DESIGN_SYSTEM_REF } from './designSystems.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';
import type { CanvasDiagnostic } from './protocol.js';
import type { SourceFiles } from './schema.js';

// One real worker for every case that only reads its answer; the cases that
// end a worker's life own their own.
const shared = new CompilerWorker();
after(() => shared.terminate());

const STATEFUL_DESIGN: SourceFiles = {
  'main.tsx': `import { useState } from 'react';
import { Button, Card } from '@droidex/design-system';
import './styles.css';
import { Counter } from './parts/Counter';

export default function Hey() {
  const [count, setCount] = useState(0);
  return (
    <Card className="flex flex-col gap-3 text-center">
      <Counter count={count} />
      <Button onClick={() => setCount(count + 1)}>Add one</Button>
    </Card>
  );
}
`,
  'parts/Counter.tsx': `export function Counter({ count }: { count: number }) {
  return <p className="counter-label">{count} so far</p>;
}
`,
  'styles.css': `.counter-label {
  letter-spacing: 0.04em;
}
`,
};

test('compiles stateful React with a relative module, a stylesheet and the kit', async () => {
  const design = await compile(STATEFUL_DESIGN);

  assert.deepEqual(design.diagnostics, []);
  assert.deepEqual(design.elements, []);
  assert.match(design.artifactId, /^[0-9a-f]{64}$/);
  assert.ok(design.html.includes('id="canvas-root"'), 'the document mounts into a root element');
  assert.ok(design.html.includes('data-mode="dark"'), 'the document carries the pinned mode');
  assert.ok(design.html.includes('useState'), 'React is bundled into the document');
  assert.ok(design.html.includes('letter-spacing: 0.04em'), "the design's own CSS is included");
  assert.ok(design.html.includes("[data-mode='dark']"), 'the kit tokens are included');
  assert.ok(design.html.includes('--ds-accent'), 'the kit tokens carry semantic names');
});

test('the compiled document is self-contained', async () => {
  const { html } = await compile(STATEFUL_DESIGN);

  assert.equal(/<script[^>]+src=/.test(html), false, 'no external script');
  assert.equal(/<link[\s/>]/.test(html), false, 'no external stylesheet');
  assert.equal(html.includes('@import'), false, 'no imported stylesheet');
  assert.equal(/url\(\s*['"]?https?:/.test(html), false, 'no remote asset');
  assert.equal(/[^.\w$]require\s*\(/.test(html), false, 'nothing asks a module loader for code');
});

test('Tailwind emits exactly the utilities the source spells out', async () => {
  const { html } = await compile(STATEFUL_DESIGN);

  for (const utility of [
    /\.flex \{/,
    /\.flex-col \{/,
    /\.gap-3 \{/,
    /\.text-center \{/,
    /\.p-6 \{/,
  ]) {
    assert.match(html, utility);
  }
  assert.equal(/\.grid \{/.test(html), false, 'an unused utility is not emitted');
});

test("the kit's own example compiles", async () => {
  const example = DROIDEX_DESIGN_SYSTEM.examples['Hey.tsx'];
  assert.ok(example, 'the kit ships a starter example');
  const design = await compile({ 'main.tsx': example });

  assert.deepEqual(design.diagnostics, []);
  assert.ok(design.html.includes("You're all set"), 'the example renders its own states');
});

test('identical input names one artifact and a change names another', async () => {
  const first = await compile(STATEFUL_DESIGN);
  const again = await compile(STATEFUL_DESIGN);
  const changed = await compile({
    ...STATEFUL_DESIGN,
    'parts/Counter.tsx': STATEFUL_DESIGN['parts/Counter.tsx']!.replace('so far', 'so good'),
  });

  assert.equal(again.artifactId, first.artifactId);
  assert.notEqual(changed.artifactId, first.artifactId);
});

test('broken TSX reports a syntax error where it is', async () => {
  const diagnostics = await diagnosticsFor({
    'main.tsx': `export default function Hey() {
  return <p>unclosed;
}
`,
  });

  assert.ok(diagnostics.length > 0, 'the author learns what is wrong');
  for (const diagnostic of diagnostics) {
    assert.equal(diagnostic.code, 'syntax_error');
    assert.equal(diagnostic.file, 'main.tsx');
    assert.equal(typeof diagnostic.line, 'number');
    assert.equal(typeof diagnostic.column, 'number');
  }
});

test('an unsupported package names the supported choices', async () => {
  const [diagnostic] = await diagnosticsFor({
    'main.tsx': `import groupBy from 'lodash/groupBy';
export default function Hey() {
  return <p>{String(groupBy)}</p>;
}
`,
  });

  assert.equal(diagnostic?.code, 'unsupported_import');
  assert.equal(diagnostic?.file, 'main.tsx');
  assert.equal(diagnostic?.line, 1);
  for (const supported of ['react', 'react-dom/client', '@droidex/design-system']) {
    assert.ok(diagnostic?.message.includes(supported), `names ${supported}`);
  }
});

test('an import that leaves the design is refused', async () => {
  const refusals: [string, string][] = [
    ['../../etc/passwd', 'unsupported_import'],
    ['/etc/passwd', 'unsupported_import'],
    ['https://cdn.example.com/widget.js', 'unsupported_import'],
    ['node:fs', 'unsupported_import'],
    ['fs', 'unsupported_import'],
    ['./parts/missing', 'missing_module'],
  ];

  for (const [specifier, code] of refusals) {
    const [diagnostic] = await diagnosticsFor({
      'main.tsx': `import '${specifier}';
export default function Hey() {
  return <p>hey</p>;
}
`,
    });
    assert.equal(diagnostic?.code, code, `${specifier} is refused as ${code}`);
    assert.equal(diagnostic.file, 'main.tsx');
    assert.equal(/\/Users\/|node_modules/.test(diagnostic.message), false, 'no path is leaked');
  }
});

test('an entry without a default export says so', async () => {
  const [diagnostic, ...rest] = await diagnosticsFor({
    'main.tsx': `export function Hey() {
  return <p>hey</p>;
}
`,
  });

  assert.deepEqual(rest, []);
  assert.equal(diagnostic?.code, 'missing_default_export');
  assert.equal(diagnostic?.file, 'main.tsx');
});

test('a design without an entry says which file is missing', async () => {
  const [diagnostic, ...rest] = await diagnosticsFor({
    'parts/Counter.tsx': STATEFUL_DESIGN['parts/Counter.tsx']!,
  });

  assert.deepEqual(rest, []);
  assert.equal(diagnostic?.code, 'missing_module');
  assert.match(diagnostic?.message ?? '', /main\.tsx/);
});

test('aborting an in-flight compile is a cancellation, not a failure', async () => {
  const controller = new AbortController();
  const pending = shared.compile(compileInput(STATEFUL_DESIGN), controller.signal);
  controller.abort();

  await assert.rejects(pending, CompileCancelledError);
  // The worker survives its cancelled job and answers the next one.
  assert.match((await compile(STATEFUL_DESIGN)).artifactId, /^[0-9a-f]{64}$/);
});

test('an already aborted signal never starts a compile', async () => {
  await assert.rejects(
    shared.compile(compileInput(STATEFUL_DESIGN), AbortSignal.abort()),
    CompileCancelledError,
  );
});

test('terminating rejects every in-flight compile and accepts no more', async () => {
  const worker = new CompilerWorker();
  const pending = worker.compile(compileInput(STATEFUL_DESIGN), new AbortController().signal);
  const settled = assert.rejects(pending, CompilerUnavailableError);

  await worker.terminate();

  await settled;
  await assert.rejects(
    worker.compile(compileInput(STATEFUL_DESIGN), new AbortController().signal),
    CompilerUnavailableError,
  );
});

test('CSS cannot make the compiler load a module from disk', async (t) => {
  // Tailwind resolves `@config` against the stylesheet's file location and then
  // requires it, and PostCSS adopts a file location from an inline source map.
  const lair = scratchDirectory(t);
  const marker = join(lair, 'executed.txt');
  writeFileSync(
    join(lair, 'evil.cjs'),
    `require('fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\nmodule.exports = { content: [] };\n`,
  );
  const sourceMap = Buffer.from(
    JSON.stringify({
      version: 3,
      file: join(lair, 'host.css'),
      sources: [],
      names: [],
      mappings: '',
    }),
  ).toString('base64');

  const [diagnostic] = await diagnosticsFor({
    ...STATEFUL_DESIGN,
    'styles.css': `@config "./evil.cjs";\n.a { color: red; }\n/*# sourceMappingURL=data:application/json;base64,${sourceMap} */\n`,
  });

  assert.equal(diagnostic?.code, 'css_error');
  assert.equal(diagnostic?.file, 'styles.css');
  assert.equal(existsSync(marker), false, 'no host code ran');
});

test('CSS cannot reach outside the preview for a resource', async () => {
  for (const value of [
    'url(https://fonts.example.com/a.woff2)',
    "url('//cdn.example.com/x.png')",
  ]) {
    const [diagnostic] = await diagnosticsFor({
      ...STATEFUL_DESIGN,
      'styles.css': `.a { background-image: ${value}; }\n`,
    });
    assert.equal(diagnostic?.code, 'css_error', value);
    assert.equal(diagnostic?.file, 'styles.css');
  }

  // An inline value is the one a preview with no network can actually render.
  const inline = await compile({
    ...STATEFUL_DESIGN,
    'styles.css': '.a { background-image: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=); }\n',
  });
  assert.ok(inline.html.includes('data:image/gif'));
});

test('no Tailwind or PostCSS configuration is read from disk or from the design', async () => {
  const { html } = await compile({
    ...STATEFUL_DESIGN,
    'main.tsx': STATEFUL_DESIGN['main.tsx']!.replace(
      'text-center',
      'text-center text-droid-accent',
    ),
    // Shaped like a real config, and ignored: the compiler passes its own.
    'tailwind.config.cjs':
      "module.exports = { theme: { extend: { colors: { smuggled: '#ff0000' } } } };\n",
  });

  assert.equal(html.includes('smuggled'), false, 'a config in the design is not honored');
  // The repository's own tailwind.config.js defines this one; the sidecar runs
  // from the repository root, so a disk lookup would find it.
  assert.equal(/\.text-droid-accent\s*\{/.test(html), false, 'no config is found on disk');
});

test('a module cannot be loaded past the allowlist at runtime', async () => {
  const loaders = [
    'export default function Hey() {\n  void import(globalThis.location.hash);\n  return <p>hey</p>;\n}\n',
    'declare const require: (id: string) => unknown;\nexport default function Hey() {\n  void require(globalThis.location.hash);\n  return <p>hey</p>;\n}\n',
  ];

  for (const main of loaders) {
    const [diagnostic] = await diagnosticsFor({ 'main.tsx': main });
    assert.equal(diagnostic?.code, 'unsupported_import');
    assert.equal(diagnostic?.file, 'main.tsx');
  }

  const [stylesheet] = await diagnosticsFor({
    ...STATEFUL_DESIGN,
    'styles.css': "@import 'https://cdn.example.com/reset.css';\n",
  });
  assert.equal(stylesheet?.code, 'css_error');
});

test('an adversarial closing tag never ends the inline style or script', async () => {
  // PostCSS escapes "<" as \3c and esbuild escapes "</script" in a string, so
  // this holds the document's own invariant rather than either tool's habit.
  const adversarial: SourceFiles[] = [
    { ...STATEFUL_DESIGN, 'styles.css': '.x { font-family: </STYLE >; }\n' },
    { ...STATEFUL_DESIGN, 'styles.css': '.x::after { content: "</style><img>"; }\n' },
    {
      'main.tsx':
        'const t = String.raw`</SCRIPT >`;\nexport default function Hey() {\n  return <p>{t}</p>;\n}\n',
    },
  ];

  for (const files of adversarial) {
    const { html } = await compile(files);
    const styles = html.slice(html.indexOf('<style>') + '<style>'.length, html.indexOf('</style>'));
    const script = html.slice(
      html.indexOf('<script>') + '<script>'.length,
      html.lastIndexOf('</script>'),
    );
    assert.equal(/<\/style/i.test(styles), false, 'the style element ends where it should');
    assert.equal(/<\/script/i.test(script), false, 'the script element ends where it should');
  }
});

test('terminating leaves no compiler service process behind', async (t) => {
  if (process.platform === 'win32') return;
  const before = compilerServiceIds();
  const worker = new CompilerWorker();
  t.after(() => worker.terminate());
  await worker.compile(compileInput(STATEFUL_DESIGN), new AbortController().signal);
  const started = [...compilerServiceIds()].filter((pid) => !before.has(pid));
  assert.ok(started.length > 0, 'the bundler runs a service process');

  await worker.terminate();

  const surviving = (): string[] => started.filter((pid) => compilerServiceIds().has(pid));
  for (let turn = 0; turn < 200 && surviving().length > 0; turn += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.deepEqual(surviving(), [], 'the service process is gone');
});

/**
 * The PIDs of the bundler's own esbuild service processes. Matched by the
 * sidecar's copy, because the test runner's loader owns one of its own.
 */
function compilerServiceIds(): Set<string> {
  const listed = execFileSync('/bin/sh', [
    '-c',
    `pgrep -P ${String(process.pid)} -f 'sidecar/node_modules/.*bin/esbuild' || true`,
  ]);
  return new Set(listed.toString().trim().split('\n').filter(Boolean));
}

function scratchDirectory(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'droidex-canvas-compile-'));
  t.after(() => {
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function compileInput(files: SourceFiles): CompileInput {
  return {
    designId: 'design-1',
    revisionId: 'revision-1',
    generation: 1,
    files,
    designSystem: DEFAULT_DESIGN_SYSTEM_REF,
  };
}

async function compile(files: SourceFiles): Promise<CompiledDesign> {
  return await shared.compile(compileInput(files), new AbortController().signal);
}

async function diagnosticsFor(files: SourceFiles): Promise<CanvasDiagnostic[]> {
  try {
    await compile(files);
  } catch (error) {
    assert.ok(error instanceof CompileFailedError, 'bad source fails the build');
    return error.diagnostics;
  }
  assert.fail('expected the compile to fail');
}
