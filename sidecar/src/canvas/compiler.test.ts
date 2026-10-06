import assert from 'node:assert/strict';
import { after, test } from 'node:test';
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
