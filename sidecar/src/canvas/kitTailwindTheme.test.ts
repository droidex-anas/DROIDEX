import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import {
  canvasRuntime,
  ownedCanvasRuntimeDir,
  startCanvasRuntime,
  stopCanvasRuntime,
} from './canvasRuntime.js';
import { CompilerWorker } from './compiler.js';
import { buildDesignStylesheet } from './designStylesheet.js';
import { kitTailwindTheme } from './kitTailwindTheme.js';
import type { DocumentSection, TokenSectionKind } from './designSystemDocument.js';
import { compileInput } from '../testing/canvasCompilerSupport.js';

function tokenSection(kind: TokenSectionKind, names: string[]): DocumentSection {
  return {
    kind,
    id: `s-${kind}`,
    title: kind,
    items: [
      {
        kind: 'group',
        id: `g-${kind}`,
        title: kind,
        tokens: names.map((name) => ({ name, value: '1px' })),
      },
    ],
  } as DocumentSection;
}

test('a kit token becomes a theme entry unless the default theme owns its name', () => {
  const sections = [
    tokenSection('colors', ['--ds-accent', '--ds-fg-muted']),
    tokenSection('typography', [
      '--ds-text-display',
      '--ds-text-lg',
      '--ds-font-heading',
      '--ds-font-sans',
    ]),
    tokenSection('radius', ['--ds-radius-pill', '--ds-radius-md']),
    tokenSection('shadows', ['--ds-shadow-glow', '--ds-shadow-sm']),
    tokenSection('motion', ['--ds-duration-exit', '--ds-duration', '--ds-ease-in']),
    tokenSection('tokens', ['--ds-sidebar-width', '--ds-z-overlay']),
  ];
  assert.deepEqual(kitTailwindTheme({ sections, files: {} }), {
    colors: {
      accent: 'color-mix(in srgb, var(--ds-accent) calc(<alpha-value> * 100%), transparent)',
      'fg-muted': 'color-mix(in srgb, var(--ds-fg-muted) calc(<alpha-value> * 100%), transparent)',
    },
    fontSize: { display: 'var(--ds-text-display)' },
    fontFamily: { heading: 'var(--ds-font-heading)' },
    borderRadius: { pill: 'var(--ds-radius-pill)' },
    boxShadow: { glow: 'var(--ds-shadow-glow)' },
    transitionDuration: { exit: 'var(--ds-duration-exit)' },
    zIndex: { overlay: 'var(--ds-z-overlay)' },
  });
  // text-lg, font-sans, radius-md, shadow-sm, duration and ease-in name stock
  // theme keys and stay stock; sidebar-width maps to no namespace.
});

const worker = new CompilerWorker();
after(() => worker.terminate());
after(() => stopCanvasRuntime());

test('kit theme classes compile to their tokens while stock classes keep stock values', async () => {
  const files = {
    'main.tsx': `import { Card } from '@droidex/design-system';

export default function Panel() {
  return (
    <Card className="rounded-md rounded-pill shadow-md font-sans font-heading duration-exit">
      <h1 className="text-lg text-code">Orders</h1>
      <p className="border-border bg-surface bg-surface/50 text-fg-muted hover:bg-active">
        Order #1042
      </p>
    </Card>
  );
}
`,
  };
  const compiled = await worker.compile(
    {
      ...compileInput(files, 'off'),
      designSystem: { id: 'droidex', version: 1, mode: 'light' },
    },
    new AbortController().signal,
  );
  assert.deepEqual(compiled.diagnostics, []);
  const css = (pattern: RegExp, name: string) =>
    assert.ok(pattern.test(compiled.html), `${name} missing from the compiled CSS`);
  // The kit's own classes read its tokens, so they follow the selected mode.
  css(/\.rounded-pill\s*\{[^}]*border-radius:\s*var\(--ds-radius-pill\)/, 'rounded-pill');
  css(/\.font-heading\s*\{[^}]*font-family:\s*var\(--ds-font-heading\)/, 'font-heading');
  css(/\.text-code\s*\{[^}]*font-size:\s*var\(--ds-text-code\)/, 'text-code');
  css(/\.duration-exit\s*\{[^}]*transition-duration:\s*var\(--ds-duration-exit\)/, 'duration-exit');
  css(
    /\.text-fg-muted\s*\{[^}]*color:\s*color-mix\(in srgb, var\(--ds-fg-muted\)/,
    'text-fg-muted',
  );
  css(
    /\.border-border\s*\{[^}]*border-color:\s*color-mix\(in srgb, var\(--ds-border\)/,
    'border-border',
  );
  css(/\.hover\\:bg-active:hover\s*\{[^}]*var\(--ds-active\)/, 'hover:bg-active');
  // An opacity modifier fills the color-mix alpha placeholder.
  css(/\.bg-surface\\\/50\s*\{[^}]*calc\(0\.5 \* 100%\)/, 'bg-surface/50');
  // Names the default theme owns keep the stock values a model expects.
  css(/\.rounded-md\s*\{[^}]*border-radius:\s*0\.375rem/, 'stock rounded-md');
  css(/\.shadow-md\s*\{[^}]*0 4px 6px/, 'stock shadow-md');
  css(/\.font-sans\s*\{[^}]*font-family:\s*ui-sans-serif/, 'stock font-sans');
  css(/\.text-lg\s*\{[^}]*font-size:\s*1\.125rem/, 'stock text-lg');
});

test('a project theme the kit carries overrides the stock keys it names, as theme.extend does', async () => {
  assert.equal(startCanvasRuntime(ownedCanvasRuntimeDir), null);
  const files = {
    'main.tsx':
      'export default () => <p className="rounded-md rounded-lg bg-primary/50 rounded-pill" />;\n',
  };
  const sections = [tokenSection('radius', ['--ds-radius-md', '--ds-radius-pill'])];
  const theme = {
    borderRadius: { md: 'calc(var(--ds-radius) - 2px)' },
    colors: { primary: 'var(--ds-primary)' },
  };
  const built = await buildDesignStylesheet(files, {
    sections,
    files: { 'tailwind.theme.json': JSON.stringify(theme) },
  });
  assert.ok(built.ok);
  const css = (pattern: RegExp, name: string) =>
    assert.ok(pattern.test(built.css), `${name} missing from the compiled CSS`);
  css(
    /\.rounded-md\s*\{[^}]*border-radius:\s*calc\(var\(--ds-radius\) - 2px\)/,
    'theme rounded-md',
  );
  // A key the theme does not name keeps its stock value; a token class is still added.
  css(/\.rounded-lg\s*\{[^}]*border-radius:\s*0\.5rem/, 'stock rounded-lg');
  css(/\.rounded-pill\s*\{[^}]*var\(--ds-radius-pill\)/, 'token rounded-pill');
  css(
    /\.bg-primary\\\/50\s*\{[^}]*color-mix\(in srgb, var\(--ds-primary\) calc\(0\.5 \* 100%\)/,
    'bg-primary/50',
  );

  const broken = await buildDesignStylesheet(files, {
    sections,
    files: { 'tailwind.theme.json': JSON.stringify({ animation: { spin: 'none' } }) },
  });
  assert.ok(!broken.ok);
  assert.equal(broken.diagnostics[0].file, '@droidex/design-system/tailwind.theme.json');
});

test('a kit key that names a stock class of another namespace leaves that class stock', async () => {
  assert.equal(startCanvasRuntime(ownedCanvasRuntimeDir), null);
  const stock = ['text-base', 'text-lg', 'border-2', 'shadow-sm', 'outline-dashed', 'text-white'];
  const files = { 'main.tsx': `export default () => <p className="${stock.join(' ')}" />;\n` };
  const colliding = [
    tokenSection('colors', ['--ds-base', '--ds-lg', '--ds-2', '--ds-sm', '--ds-dashed']),
    tokenSection('typography', ['--ds-text-white']),
  ];
  const stockRules = async (sections: DocumentSection[]) => {
    const built = await buildDesignStylesheet(files, { files: {}, sections });
    assert.ok(built.ok);
    const rules = new Map<string, string>();
    canvasRuntime()
      .postcss.parse(built.css)
      .walkRules((rule) => {
        const name = rule.selector.slice(1);
        if (stock.includes(name)) rules.set(name, rule.toString());
      });
    return rules;
  };
  const withoutKit = await stockRules([]);
  assert.deepEqual([...withoutKit.keys()].sort(), [...stock].sort());
  assert.deepEqual(await stockRules(colliding), withoutKit);
});
