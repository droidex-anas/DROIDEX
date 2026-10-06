import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, test, type TestContext } from 'node:test';
import {
  CompileCancelledError,
  CompileFailedError,
  CompilerUnavailableError,
  CompilerWorker,
  RUNTIME_UNAVAILABLE,
  compilerResponse,
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

test('a runtime the app owns but cannot vouch for compiles nothing', async (t) => {
  // Both cases would otherwise compile: the checkout's own node_modules sits
  // beside this fixture, where node looks next, and esbuild falls back to its
  // own copy of the binary when ESBUILD_BINARY_PATH names a file that is not
  // there. That the refused worker also loads nothing, through shutdown, is
  // measured by tools/canvas-compiler-probe.ts, which owns the child's
  // environment and can trace its resolutions.
  const damaged: [string, Record<string, unknown>][] = [
    ['a file its manifest lists is gone', { 'node_modules/absent/index.js': 12 }],
    ['nothing is wrong but its binary', {}],
  ];

  for (const [reason, files] of damaged) {
    const layout = scratchDirectory(t);
    symlinkSync(resolve(import.meta.dirname, '../../node_modules'), join(layout, 'node_modules'));
    const runtime = join(layout, 'canvas-runtime');
    mkdirSync(runtime);
    writeFileSync(
      join(runtime, 'manifest.json'),
      `${JSON.stringify({ binary: 'node_modules/@esbuild/absent/bin/esbuild', files })}\n`,
    );

    const worker = new CompilerWorker();
    const compiling = withOwnedRuntime(runtime, () =>
      worker.compile(compileInput(STATEFUL_DESIGN), new AbortController().signal),
    );
    // The reason reaches a caller, so it is the one curated sentence and
    // carries no machine path, exactly like a design's own diagnostics.
    await assert.rejects(compiling, (error: unknown) => {
      assert.ok(error instanceof CompilerUnavailableError, reason);
      // The reason, not the text, is what tells the build queue that no restart
      // will repair this.
      assert.equal(error.reason, 'damaged-runtime', reason);
      assert.equal(error.message, RUNTIME_UNAVAILABLE, reason);
      assert.equal(machinePath(error.message), null, reason);
      return true;
    });

    // Shutdown is the other way into the loader, so a refused worker still has
    // to stop cleanly rather than be killed on the grace timeout.
    await worker.terminate();
    await assert.rejects(
      worker.compile(compileInput(STATEFUL_DESIGN), new AbortController().signal),
      CompilerUnavailableError,
      `${reason}, after terminating`,
    );
  }
});

test('a reply the protocol does not define is not an answer', () => {
  // What the forked compiler sends is the one thing here this module does not
  // write, and an unknown reason would otherwise reach the renderer as advice
  // to restart. This covers the rule, not its wiring: `liveCompiler`'s listener
  // calling it, losing and ending the process, and the next build forking a
  // replacement, are exercised only by a throwaway probe driving a real child,
  // because nothing can make the packaged worker send a malformed reply —
  // `compilerEnv` deletes NODE_OPTIONS and the entry path is not injectable.
  const unavailable = {
    requestId: 1,
    status: 'unavailable',
    reason: 'damaged-runtime',
    message: RUNTIME_UNAVAILABLE,
  };
  assert.deepEqual(compilerResponse(unavailable), unavailable);
  assert.deepEqual(compilerResponse({ requestId: 2, status: 'stopped' }), {
    requestId: 2,
    status: 'stopped',
  });

  for (const malformed of [
    null,
    'stopped',
    { status: 'stopped' },
    { requestId: '1', status: 'stopped' },
    { requestId: 1, status: 'invented' },
    { ...unavailable, reason: 'invented' },
    { ...unavailable, reason: undefined },
    { ...unavailable, reason: { damaged: true } },
    { ...unavailable, message: 12 },
    { requestId: 1, status: 'ready' },
    { requestId: 1, status: 'ready', design: { artifactId: 'a', html: 'h' } },
    { requestId: 1, status: 'failed' },
  ]) {
    assert.equal(compilerResponse(malformed), null, JSON.stringify(malformed));
  }
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
  const refused: [string, SourceFiles][] = [
    [
      'a plain remote url',
      { 'styles.css': '.a { background-image: url(https://cdn.example.com/x.png); }\n' },
    ],
    [
      'a protocol-relative url',
      { 'styles.css': ".a { background-image: url('//cdn.example.com/x.png'); }\n" },
    ],
    [
      'a remote font',
      {
        'styles.css':
          "@font-face { font-family: X; src: url('https://cdn.example.com/x.woff2'); }\n",
      },
    ],
    // The function name is escaped, which the CSS tokenizer splits in two.
    [
      'an escaped url function',
      { 'styles.css': '.a { background: \\75 rl(https://cdn.example.com/x.png); }\n' },
    ],
    [
      'an escaped image set',
      { 'styles.css': '.a { background: image\\2d set("https://cdn.example.com/x.png" 1x); }\n' },
    ],
    [
      'a remote image in a set',
      { 'styles.css': '.a { background: image-set(url(https://cdn.example.com/x.png) 1x); }\n' },
    ],
    // Written in the TSX, so it only appears in Tailwind's generated CSS.
    [
      'a remote url in a utility',
      {
        'main.tsx':
          'export default function Hey() {\n  return <p className="bg-[url(https://cdn.example.com/x.png)]">hey</p>;\n}\n',
      },
    ],
  ];

  for (const [reason, files] of refused) {
    const [diagnostic] = await diagnosticsFor({ ...STATEFUL_DESIGN, ...files });
    assert.equal(diagnostic?.code, 'css_error', reason);
    assert.ok(diagnostic.message.includes('cdn.example.com'), `${reason} names what it refused`);
  }

  // Inline data is what a preview with no network can actually render, in any
  // quoting and with any spacing, and Tailwind's own syntax is untouched.
  const accepted: [string, SourceFiles][] = [
    [
      'a quoted data url',
      {
        'styles.css':
          '.a { background-image: url( "data:image/gif;base64,R0lGODlhAQABAAAAACw=" ); }\n',
      },
    ],
    [
      'an unquoted data url',
      {
        'styles.css': '.a { background-image: url(data:image/gif;base64,R0lGODlhAQABAAAAACw=); }\n',
      },
    ],
    [
      'a data image set',
      {
        'styles.css':
          '.a { background: image-set("data:image/gif;base64,R0lGODlhAQABAAAAACw=" 1x); }\n',
      },
    ],
    [
      'apply and theme',
      { 'styles.css': '.a { @apply flex gap-3; color: theme(colors.red.500); }\n' },
    ],
  ];

  for (const [reason, files] of accepted) {
    const { html } = await compile({ ...STATEFUL_DESIGN, ...files });
    assert.ok(html.includes('<style>'), reason);
  }
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

test('a glob import cannot reach the real filesystem', async () => {
  // esbuild turns a template literal with a static relative prefix into a glob
  // and expands it underneath the plugins, by listing the importer's resolve
  // directory. Only a directory that does not exist keeps that off the
  // sidecar's own tree; a file resolved from outside the design is reported as
  // compile_failed, which is what must never appear here.
  for (const extension of ['tsx', 'css', 'ts']) {
    const diagnostics = await diagnosticsFor({
      'main.tsx': [
        'import(`./${globalThis.location.hash}.' + extension + '`);',
        'export default function Hey() {',
        '  return <p>hey</p>;',
        '}',
        '',
      ].join('\n'),
    });

    assert.deepEqual(
      diagnostics.map((diagnostic) => diagnostic.code),
      ['unsupported_import'],
      `one refusal for .${extension}, and nothing resolved outside the design`,
    );
    assert.equal(diagnostics[0]?.file, 'main.tsx');
  }
});

test('the supported packages resolve without node resolution from a design', async () => {
  const design = await compile({
    'main.tsx': `import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '@droidex/design-system';

export default function Hey() {
  const [count, setCount] = useState(0);
  void createRoot;
  return <Button onClick={() => setCount(count + 1)}>{count}</Button>;
}
`,
  });

  assert.deepEqual(design.diagnostics, []);
  assert.ok(design.html.includes('useState'), 'React is bundled from its real package');
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

test('ending the compiler leaves no process of its own behind', async (t) => {
  if (process.platform === 'win32') return;
  // esbuild's service is killed but never reaped by the loop that spawned it
  // unless that loop is a process the sidecar owns, so both PIDs are captured
  // while they are alive: a <defunct> process no longer matches by name.
  for (const ending of ['terminate', 'crash'] as const) {
    const others = compilerProcessIds();
    const worker = new CompilerWorker();
    t.after(() => worker.terminate());
    await worker.compile(compileInput(STATEFUL_DESIGN), new AbortController().signal);

    const compiler = [...compilerProcessIds()].find((pid) => !others.has(pid));
    assert.ok(compiler, 'the compiler runs in a process of its own');
    const service = childProcessIds(compiler)[0];
    assert.ok(service, 'the bundler runs a service process');

    if (ending === 'terminate') await worker.terminate();
    else process.kill(Number(compiler), 'SIGKILL');

    for (let turn = 0; turn < 500; turn += 1) {
      if (!processState(compiler) && !processState(service)) break;
      await new Promise((resolve) => setImmediate(resolve));
    }
    // A reaped process has no state at all; a zombie still reports one.
    assert.equal(processState(compiler), '', `compiler gone after ${ending}`);
    assert.equal(processState(service), '', `service gone after ${ending}`);
  }
});

function compilerProcessIds(): Set<string> {
  return new Set(listProcesses(`pgrep -P ${String(process.pid)} -f compilerWorker`));
}

function childProcessIds(parent: string): string[] {
  return listProcesses(`pgrep -P ${parent}`);
}

function processState(pid: string): string {
  return shell(`ps -o stat= -p ${pid} || true`);
}

function listProcesses(command: string): string[] {
  return shell(`${command} || true`).split('\n').filter(Boolean);
}

function shell(command: string): string {
  return execFileSync('/bin/sh', ['-c', command]).toString().trim();
}

/**
 * Runs `start` with `runtime` as the directory the app owns. The compiler reads
 * the variable in the child it forks, and `compile` forks before it returns, so
 * the mutation lasts exactly that one synchronous call.
 */
function withOwnedRuntime<T>(runtime: string, start: () => T): T {
  const previous = process.env.DROIDEX_CANVAS_RUNTIME_DIR;
  process.env.DROIDEX_CANVAS_RUNTIME_DIR = runtime;
  try {
    return start();
  } finally {
    if (previous === undefined) delete process.env.DROIDEX_CANVAS_RUNTIME_DIR;
    else process.env.DROIDEX_CANVAS_RUNTIME_DIR = previous;
  }
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

/**
 * The machine path a diagnostic must never carry, anywhere in any field, quoted
 * or not: a diagnostic reaches the model and the user, so it names design paths
 * only, and a compiler or runtime path means a machine failure is being
 * reported as the design's fault (spec §8).
 */
function machinePath(text: string): string | null {
  const roots = ['/Users/', '/home/', '/private/', '/tmp/', '/var/', 'node_modules'];
  return (
    [...roots, resolve(import.meta.dirname, '../../..')].find((root) => text.includes(root)) ?? null
  );
}

test('a diagnostic may not carry a machine path, quoted or not', () => {
  for (const leaked of [
    'ENOENT: could not open "/Users/example/Library/runtime.js"',
    "Cannot find module 'react' from '/private/tmp/app/canvas-runtime'",
    'see node_modules/tailwindcss/lib/css/preflight.css',
    `missing ${resolve(import.meta.dirname, '../../..')}/sidecar/dist/compilerWorker.mjs`,
  ]) {
    assert.notEqual(machinePath(leaked), null, leaked);
  }
  assert.equal(machinePath('main.tsx must default-export a React component.'), null);
});

async function diagnosticsFor(files: SourceFiles): Promise<CanvasDiagnostic[]> {
  try {
    await compile(files);
  } catch (error) {
    assert.ok(error instanceof CompileFailedError, 'bad source fails the build');
    for (const diagnostic of error.diagnostics) {
      const text = `${diagnostic.code} ${diagnostic.message} ${diagnostic.file ?? ''}`;
      assert.equal(machinePath(text), null, `no machine path in ${text}`);
    }
    return error.diagnostics;
  }
  assert.fail('expected the compile to fail');
}
