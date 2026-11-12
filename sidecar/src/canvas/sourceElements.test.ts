import assert from 'node:assert/strict';
import { SourceMap } from 'node:module';
import { test } from 'node:test';
import type { SourceElement, SourceFiles } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';
import { applyElementEdit, type SourceChange, type SourceEdit } from './sourceElementEdits.js';
import { SourceElementError } from './sourceElementError.js';
import { instrumentSource } from './sourceElements.js';
import type { ResolvedStyle } from './sourceStyles.js';

function reference(element: SourceElement, revisionId = 'r1') {
  return { designId: 'design', revisionId, elementId: element.elementId, instancePath: '0' };
}

function onlyElement(files: SourceFiles) {
  const mapped = instrumentSource(files, 'r1');
  assert.equal(mapped.elements.length, 1);
  const element = mapped.elements[0];
  assert.ok(element);
  return { ...mapped, element };
}

test('text, style and image edits return complete changed files without touching surrounding bytes', () => {
  const cases: { markup: string; change: SourceChange; changed: string }[] = [
    {
      markup: '<h1></h1>',
      change: { kind: 'text', value: 'Welcome back' },
      changed: '<h1>Welcome back</h1>',
    },
    {
      markup: '<h1>Hello &amp; bye</h1>',
      change: { kind: 'text', value: 'Welcome' },
      changed: '<h1>Welcome</h1>',
    },
    {
      markup: '<h1>Hello</h1>',
      change: { kind: 'text', value: '<&>"\'{}界\n x' },
      changed: '<h1>&lt;&amp;&gt;&quot;&#39;&#123;&#125;界&#10; x</h1>',
    },
    {
      markup: '<h1>{`Hello`}</h1>',
      change: { kind: 'text', value: 'Line\n${safe}' },
      changed: '<h1>{"Line\\n${safe}"}</h1>',
    },
    {
      markup: "<h1 style={{ color: 'var(--ds-text)' }}>Hello</h1>",
      change: {
        kind: 'style',
        styles: [{ property: 'color', resolution: { kind: 'token', token: '--ds-accent' } }],
      },
      changed: '<h1 className="text-[color:var(--ds-accent)]">Hello</h1>',
    },
    {
      markup: '<img src={`canvas-asset:old`} style={{opacity:1}} />',
      change: { kind: 'image', assetId: 'new-image' },
      changed: '<img src={"canvas-asset:new-image"} style={{opacity:1}} />',
    },
    {
      markup: '<img src="canvas-asset:old" alt="Keep this" />',
      change: { kind: 'image', assetId: 'new-image' },
      changed: '<img src="canvas-asset:new-image" alt="Keep this" />',
    },
  ];
  for (const fixture of cases) {
    const before = '/* preserve */\r\nexport default function App() { return (\n  ';
    const after = '\n); } // preserve\n';
    const source = before + fixture.markup + after;
    const files = { 'main.tsx': source, 'untouched.ts': '// untouched\n' };
    const mapped = onlyElement(files);
    const changed = applyElementEdit(files, mapped.elements, {
      element: reference(mapped.element),
      change: fixture.change,
    });
    assert.deepEqual(changed, { 'main.tsx': before + fixture.changed + after });
    assert.equal(files['main.tsx'], source, 'canonical input stays untouched');
    assert.equal(
      instrumentSource({ ...files, ...changed }, 'r2').elements.length,
      1,
      'the edited source still parses',
    );
  }
});

const token = (name: string) => ({ kind: 'token', token: name }) as const;
const raw = (value: string) => ({ kind: 'raw', value }) as const;

test('a style edit writes the class that says it in place of the classes it makes dead', () => {
  const cases: { markup: string; styles: ResolvedStyle[]; changed: string }[] = [
    {
      markup: '<h1 className="p-4 text-lg">Hi</h1>',
      styles: [{ property: 'padding', resolution: token('--ds-space-2') }],
      changed: '<h1 className="p-[var(--ds-space-2)] text-lg">Hi</h1>',
    },
    {
      markup: '<h1 className="flex px-2  pt-1 gap-2">Hi</h1>',
      styles: [{ property: 'padding', resolution: raw('16px') }],
      changed: '<h1 className="flex p-4 gap-2">Hi</h1>',
    },
    {
      markup: '<h1 className={cn("flex", "pt-1", "pb-1")}>Hi</h1>',
      styles: [{ property: 'padding', resolution: raw('1rem') }],
      changed: '<h1 className={cn("flex", "p-4")}>Hi</h1>',
    },
    {
      markup: '<h1 className="text-sm font-bold">Hi</h1>',
      styles: [{ property: 'fontSize', resolution: token('--ds-text-lg') }],
      changed: '<h1 className="text-[length:var(--ds-text-lg)] font-bold leading-5">Hi</h1>',
    },
    {
      markup: '<h1 className="flex flex-row">Hi</h1>',
      styles: [{ property: 'flexDirection', resolution: raw('column') }],
      changed: '<h1 className="flex flex-col">Hi</h1>',
    },
    {
      markup: '<h1 style={{ color: "var(--ds-fg)", gap: 4 }}>Hi</h1>',
      styles: [{ property: 'color', resolution: token('--ds-accent') }],
      changed: '<h1 className="text-[color:var(--ds-accent)]" style={{ gap: 4 }}>Hi</h1>',
    },
    {
      markup: '<h1 style={{opacity:1}}>Hi</h1>',
      styles: [{ property: 'opacity', resolution: raw('0.5') }],
      changed: '<h1 className="opacity-50">Hi</h1>',
    },
    {
      markup: '<h1 className="!p-2">Hi</h1>',
      styles: [{ property: 'padding', resolution: raw('16px') }],
      changed: '<h1 className="!p-4">Hi</h1>',
    },
    {
      markup: '<div className="p-2 flex">Hi</div>',
      styles: [
        { property: 'padding', resolution: token('--ds-space-4') },
        { property: 'gap', resolution: raw('8px') },
        { property: 'backgroundColor', resolution: token('--ds-surface') },
        { property: 'marginTop', resolution: raw('-16px') },
        { property: 'color', resolution: raw('#a1b2c3') },
      ],
      changed:
        '<div className="p-[var(--ds-space-4)] flex gap-2 bg-[color:var(--ds-surface)] -mt-4" style={{ color: "#a1b2c3" }}>Hi</div>',
    },
    {
      markup: '<div className="grayscale blur-sm">Hi</div>',
      styles: [
        { property: 'filter', resolution: raw('blur(16px)') },
        { property: 'backdropFilter', resolution: token('--ds-blur-soft') },
        {
          property: 'boxShadow',
          resolution: { kind: 'tokens', tokens: ['--ds-shadow-sm', '--ds-shadow-md'] },
        },
      ],
      changed:
        '<div className="grayscale blur-lg backdrop-blur-[var(--ds-blur-soft)] shadow-[shadow:var(--ds-shadow-sm),var(--ds-shadow-md)]">Hi</div>',
    },
    {
      markup: '<div className="filter-none backdrop-filter-none">Hi</div>',
      styles: [
        { property: 'filter', resolution: raw('blur(16px)') },
        { property: 'backdropFilter', resolution: raw('blur(16px)') },
      ],
      changed: '<div className="blur-lg backdrop-blur-lg">Hi</div>',
    },
  ];
  for (const { markup, styles, changed } of cases) {
    const files = { 'main.tsx': `export default () => ${markup};\n` };
    const mapped = onlyElement(files);
    const edit: SourceEdit = {
      element: reference(mapped.element),
      change: { kind: 'style', styles },
    };
    const first = applyElementEdit(files, mapped.elements, edit);
    assert.deepEqual(first, { 'main.tsx': `export default () => ${changed};\n` });
    assert.deepEqual(
      applyElementEdit(files, mapped.elements, edit),
      first,
      'same edit, same bytes',
    );
    assert.equal(onlyElement(first).element.editability, 'literal', 'still directly editable');
  }
});

test('a style no class can say, or one a class would not win for, is written inline', () => {
  const cases: { markup: string; styles: ResolvedStyle[]; changed: string }[] = [
    {
      markup: '<img src="canvas-asset:a" />',
      styles: [{ property: 'width', resolution: raw('321px') }],
      changed: '<img src="canvas-asset:a" style={{ width: 321 }} />',
    },
    {
      markup: '<h1 style={{ lineHeight: 1.2, }}>Hi</h1>',
      styles: [{ property: 'lineHeight', resolution: raw('1.4') }],
      changed: '<h1 style={{ lineHeight: 1.4, }}>Hi</h1>',
    },
    {
      markup: '<h1 className="md:p-2">Hi</h1>',
      styles: [{ property: 'padding', resolution: raw('0') }],
      changed: '<h1 className="md:p-2" style={{ padding: 0 }}>Hi</h1>',
    },
    {
      markup: '<h1 style={{ padding: 8 }}>Hi</h1>',
      styles: [{ property: 'paddingTop', resolution: token('--ds-space-4') }],
      changed: '<h1 style={{ padding: 8, paddingTop: "var(--ds-space-4)" }}>Hi</h1>',
    },
  ];
  for (const { markup, styles, changed } of cases) {
    const files = { 'main.tsx': `export default () => ${markup};\n` };
    const mapped = onlyElement(files);
    const first = applyElementEdit(files, mapped.elements, {
      element: reference(mapped.element),
      change: { kind: 'style', styles },
    });
    assert.deepEqual(first, { 'main.tsx': `export default () => ${changed};\n` });
  }
});

test('a blur that would drop the rest of a filter set another way is left to the agent', () => {
  for (const markup of [
    '<div className="md:blur-sm">Hi</div>',
    '<div className="md:filter-none">Hi</div>',
    '<div className="[filter:grayscale(1)_blur(2px)]">Hi</div>',
    '<div style={{ filter: "grayscale(1)" }}>Hi</div>',
  ]) {
    const files = { 'main.tsx': `export default () => ${markup};\n` };
    const mapped = onlyElement(files);
    assert.throws(
      () =>
        applyElementEdit(files, mapped.elements, {
          element: reference(mapped.element),
          change: { kind: 'style', styles: [{ property: 'filter', resolution: raw('blur(8px)') }] },
        }),
      (error: unknown) => error instanceof SourceElementError && error.code === 'ambiguous_element',
      markup,
    );
  }
});

test('a raw value whose stock class the kit theme gives its own value is written inline', () => {
  const files = { 'main.tsx': 'export default () => <div className="rounded-lg">Hi</div>;\n' };
  const mapped = onlyElement(files);
  const styles: ResolvedStyle[] = [
    { property: 'borderRadius', resolution: raw('6px') },
    { property: 'padding', resolution: raw('8px') },
  ];
  const changed = applyElementEdit(files, mapped.elements, {
    element: reference(mapped.element),
    change: { kind: 'style', styles, theme: { borderRadius: { md: 'calc(var(--radius) - 2px)' } } },
  });
  assert.deepEqual(changed, {
    'main.tsx': 'export default () => <div className="p-2" style={{ borderRadius: 6 }}>Hi</div>;\n',
  });
});

test('a font size the kit theme gives its own value takes no stock line height with it', () => {
  const files = { 'main.tsx': 'export default () => <h1 className="text-lg font-bold">Hi</h1>;\n' };
  const mapped = onlyElement(files);
  const styles: ResolvedStyle[] = [{ property: 'fontSize', resolution: token('--ds-text-lg') }];
  const changed = applyElementEdit(files, mapped.elements, {
    element: reference(mapped.element),
    change: { kind: 'style', styles, theme: { fontSize: { lg: '20px' } } },
  });
  assert.deepEqual(changed, {
    'main.tsx':
      'export default () => <h1 className="text-[length:var(--ds-text-lg)] font-bold">Hi</h1>;\n',
  });
});

test('revision, source changes and forged ranges cannot retarget a selection', () => {
  const files = { 'main.tsx': 'export default () => <h1>Hello</h1>' };
  const mapped = onlyElement(files);
  const other = instrumentSource(files, 'r2');
  const edit: SourceEdit = {
    element: reference(mapped.element),
    change: { kind: 'text', value: 'Welcome' },
  };
  for (const [source, elements, request] of [
    [files, other.elements, edit],
    [files, mapped.elements, { ...edit, element: reference(mapped.element, 'r2') }],
    [{ ...files, 'main.tsx': files['main.tsx'].replace('Hello', 'Later') }, mapped.elements, edit],
    [files, [{ ...mapped.element, start: 0 }], edit],
    [files, [mapped.element, mapped.element], edit],
  ] satisfies [SourceFiles, SourceElement[], SourceEdit][]) {
    assert.throws(
      () => applyElementEdit(source, elements, request),
      (error: unknown) => {
        assert.ok(error instanceof SourceElementError);
        assert.equal(error.code, 'stale_reference');
        assert.match(error.message, /Reselect/);
        return true;
      },
    );
  }
});

test('shared and computed sites report their scope and refuse direct edits', () => {
  const cases: [string, SourceElement['editability']][] = [
    ['export default () => <h1 {...props}>Hello</h1>', 'computed'],
    ['export default () => <h1>{...children}</h1>', 'computed'],
    ['export default () => <h1 children="Hello" />', 'computed'],
    ['export default () => <h1>{`Hello ${name}`}</h1>', 'computed'],
    ['export default () => <h1>Hello {"world"}</h1>', 'computed'],
    ['export default () => <h1 className={active ? "yes" : "no"}>Hello</h1>', 'computed'],
    ['export default () => <h1 className={cn("p-2", active && "on")}>Hello</h1>', 'computed'],
    ['export default () => <path fill={active ? "#fff" : "#000"} />', 'computed'],
    ['export default () => <path stroke-width={width} />', 'computed'],
    ['export default () => <path d={icon.path} />', 'computed'],
    ['export default () => <h1 style={{...styles, color:"var(--ds-text)"}}>Hello</h1>', 'computed'],
    [
      'export default () => <h1 style={{color:"var(--ds-text)", color:"var(--ds-accent)"}}>Hello</h1>',
      'computed',
    ],
    ['export default function App(){return <><h1>Hello</h1><App /></>}', 'shared'],
    ['export default () => [1,2].map(n => <h1>Hello</h1>)', 'shared'],
    [
      'function Heading(){return <h1>Hello</h1>} export default () => <><Heading/><Heading/></>',
      'shared',
    ],
    [
      'export default function App(){const heading = <h1>Hello</h1>; return <>{heading}{heading}</>}',
      'shared',
    ],
    ['export default () => <Repeater><h1>Hello</h1></Repeater>', 'shared'],
  ];
  for (const [source, scope] of cases) {
    const files = { 'main.tsx': source };
    const mapped = onlyElement(files);
    assert.equal(mapped.element.editability, scope, source);
    assert.throws(
      () =>
        applyElementEdit(files, mapped.elements, {
          element: reference(mapped.element),
          change: { kind: 'text', value: 'One instance' },
        }),
      (error: unknown) => error instanceof SourceElementError && error.code === 'ambiguous_element',
    );
  }
});

test('each element names its line and the component it is written in', () => {
  const files = {
    'main.tsx': `function Badge() {
  return <span>New</span>;
}
const Card = memo(() => (
  <section>
    {[1, 2].map((n) => <p>{n}</p>)}
  </section>
));
const Field = memo(forwardRef((props, ref) => <input ref={ref} />));
function App({ items }) {
  const Options = items.map((i) => <option>{i}</option>);
  return <main><Badge /><Card /><Field /><select>{Options}</select></main>;
}
`,
  };
  const located = instrumentSource(files, 'r1').elements.map(({ tagName, line, component }) => [
    tagName,
    line,
    component,
  ]);
  assert.deepEqual(located, [
    ['span', 2, 'Badge'],
    ['section', 5, 'Card'],
    ['p', 6, 'Card'],
    ['input', 9, 'Field'],
    ['option', 11, 'App'],
    ['main', 12, 'App'],
    ['select', 12, 'App'],
  ]);
});

test('JSX props passed to self-closing components refuse instance-local edits', () => {
  const source = `function List({item}) { return <>{item}{item}</>; }
export default () => <List item={<span>Row</span>} />;`;
  const files = { 'main.tsx': source };
  const mapped = onlyElement(files);

  assert.throws(
    () =>
      applyElementEdit(files, mapped.elements, {
        element: reference(mapped.element),
        change: { kind: 'text', value: 'Only this row' },
      }),
    (error: unknown) => error instanceof SourceElementError && error.code === 'ambiguous_element',
  );
  assert.equal(mapped.element.editability, 'shared');
  assert.equal(files['main.tsx'], source, 'refusing an ambiguous edit leaves source unchanged');
});

test('an entry imported by another source module is shared too', () => {
  const files = {
    'main.tsx': 'export default function App(){return <h1>Hello</h1>}',
    'parts/Other.tsx': "import Root from '../main'; export default () => <Root />",
  };
  const mapped = onlyElement(files);
  assert.equal(mapped.element.editability, 'shared');
  assert.throws(
    () =>
      applyElementEdit(files, mapped.elements, {
        element: reference(mapped.element),
        change: { kind: 'text', value: 'Just one' },
      }),
    (error: unknown) => error instanceof SourceElementError && error.code === 'ambiguous_element',
  );
});

const TOP_BAR =
  'export function TopBar() { return <header className="p-2"><h1>Title</h1></header>; }';

function editabilityIn(files: SourceFiles, file: string) {
  return instrumentSource(files, 'r1')
    .elements.filter((element) => element.file === file)
    .map(({ tagName, editability }) => [tagName, editability]);
}

test('a component rendered once is edited where it is written, in whichever file', () => {
  for (const main of [
    "import { TopBar } from './components/TopBar'; export default () => <main><TopBar /></main>",
    "import { TopBar as Bar } from './components/TopBar.tsx'; export default function App() { return <main>{open && <Bar />}</main> }",
    "import { TopBar } from './components/TopBar'; function Page() { return <TopBar /> } export default function App() { return <main><Page /></main> }",
  ]) {
    const files = { 'main.tsx': main, 'components/TopBar.tsx': TOP_BAR };
    assert.deepEqual(
      editabilityIn(files, 'components/TopBar.tsx'),
      [
        ['header', 'literal'],
        ['h1', 'literal'],
      ],
      main,
    );
    const mapped = instrumentSource(files, 'r1');
    const heading = mapped.elements.find((element) => element.tagName === 'h1');
    assert.ok(heading);
    assert.deepEqual(
      applyElementEdit(files, mapped.elements, {
        element: reference(heading),
        change: { kind: 'text', value: 'Inbox' },
      }),
      { 'components/TopBar.tsx': TOP_BAR.replace('Title', 'Inbox') },
    );
  }
  const defaultExport = {
    'main.tsx': "import Bar from './Bar'; export default () => <Bar />",
    'Bar.tsx': 'function Bar() { return <nav>Menu</nav> } export default Bar;',
  };
  assert.deepEqual(editabilityIn(defaultExport, 'Bar.tsx'), [['nav', 'literal']]);
});

test('a component that may render more than once, or by indirection, keeps its elements shared', () => {
  const imported = "import { TopBar } from './components/TopBar';";
  const designs: SourceFiles[] = [
    { 'main.tsx': `${imported} export default () => <main><TopBar /><TopBar /></main>` },
    {
      'main.tsx': `${imported} import { TopBar as Again } from './components/TopBar'; export default () => <main><TopBar /><Again /></main>`,
    },
    { 'main.tsx': `${imported} export default () => <main><Frame slot={TopBar} /></main>` },
    {
      'main.tsx': `${imported} const Header = TopBar; export default () => <main><Header /></main>`,
    },
    { 'main.tsx': `${imported} export default () => <main>{createElement(TopBar)}</main>` },
    {
      'main.tsx': `${imported} export default () => <main>{[1, 2].map(() => <TopBar />)}</main>`,
    },
    {
      'main.tsx': `${imported} function Row() { return <TopBar /> } export default () => <main><Row /><Row /></main>`,
    },
    { 'main.tsx': `${imported} export default () => <main><Shell top={<TopBar />} /></main>` },
    {
      'main.tsx':
        "import * as parts from './components/TopBar'; export default () => <main><parts.TopBar /></main>",
    },
    {
      'main.tsx': `${imported} import { TopBar as Again } from './parts'; export default () => <main><TopBar /><Again /></main>`,
      'parts.ts': "export { TopBar } from './components/TopBar';",
    },
    {
      'main.tsx': `${imported} const Lazy = lazy(() => import('./components/TopBar')); export default () => <main><TopBar /></main>`,
    },
  ];
  for (const files of designs) {
    const all = { ...files, 'components/TopBar.tsx': TOP_BAR };
    assert.deepEqual(
      editabilityIn(all, 'components/TopBar.tsx'),
      [
        ['header', 'shared'],
        ['h1', 'shared'],
      ],
      files['main.tsx'],
    );
  }
  for (const main of [
    'function Tree() { return <ul><Tree /></ul> } export default () => <Tree />',
    'function A() { return <ul><B /></ul> } function B() { return <A /> } export default () => <A />',
  ])
    assert.deepEqual(editabilityIn({ 'main.tsx': main }, 'main.tsx'), [['ul', 'shared']], main);
});

test('every way a copy could render unseen keeps the element shared', () => {
  const topBar = 'export function TopBar() { return <header>Title</header> }';
  const designs: SourceFiles[] = [
    {
      'TopBar.tsx': topBar,
      'barrel.ts': "import { TopBar } from './TopBar'; export { TopBar };",
      'main.tsx':
        "import { TopBar } from './TopBar'; import { TopBar as Again } from './barrel'; export default () => <><TopBar /><Again /></>;",
    },
    {
      'TopBar.tsx': topBar,
      'barrel.ts': "import { TopBar } from './TopBar'; export default TopBar;",
      'main.tsx':
        "import { TopBar } from './TopBar'; import Again from './barrel'; export default () => <><TopBar /><Again /></>;",
    },
    {
      'main.tsx':
        'const TopBar = function Inner({ depth = 1 }) { return <><header>Title</header>{depth > 0 && <Inner depth={depth - 1} />}</>; }; export default () => <TopBar />;',
    },
    {
      'main.tsx':
        "import { memo } from 'react'; export default memo(function Inner({ depth = 1 }) { return <><header>Title</header>{depth > 0 && <Inner depth={depth - 1} />}</>; });",
    },
    {
      'TopBar.tsx': topBar,
      'main.tsx':
        "import { TopBar } from './TopBar'; export default function App() { let item; item = <TopBar />; return <>{item}{item}</>; }",
    },
    {
      'TopBar.tsx': topBar,
      'main.tsx':
        "import { TopBar } from './TopBar'; export default function App() { const items = {}; items.one = <TopBar />; return <>{items.one}{items.one}</>; }",
    },
    {
      'main.tsx':
        'function memo(render) { return () => <>{render()}{render()}</>; } const TopBar = memo(() => <header>Title</header>); export default () => <TopBar />;',
    },
    {
      'main.tsx':
        'const React = { memo: (render) => () => <>{render()}{render()}</> }; const TopBar = React.memo(() => <header>Title</header>); export default () => <TopBar />;',
    },
    {
      'main.tsx':
        "function Panel({ children }) { return <>{children}{arguments[0]['children']}</>; } export default () => <Panel><header>Title</header></Panel>;",
    },
    {
      'main.tsx':
        "function Panel({ children, ['children']: again }) { return <>{children}{again}</>; } export default () => <Panel><header>Title</header></Panel>;",
    },
    {
      'TopBar.tsx': topBar,
      'main.tsx':
        "import { TopBar } from './TopBar'; const { TopBar: Again } = require('./TopBar'); export default () => <><TopBar /><Again /></>;",
    },
    {
      'TopBar.tsx': topBar,
      'main.tsx':
        "import { TopBar } from './TopBar'; const page = './TopBar'; import(page); export default () => <TopBar />;",
    },
    {
      'TopBar.tsx': topBar,
      'main.tsx':
        "import { TopBar } from './TopBar'; import C = require('./TopBar'); export default () => <><TopBar /><C.TopBar /></>;",
    },
    {
      'TopBar.tsx': 'function TopBar() { return <header>Title</header> } export = TopBar;',
      'main.tsx':
        "import TopBar from './TopBar'; import Again = require('./TopBar'); export default () => <><TopBar /><Again /></>;",
    },
    {
      'main.tsx':
        "import React from 'react'; React.memo = (render) => () => <>{render()}{render()}</>; const TopBar = React.memo(() => <header>Title</header>); export default () => <TopBar />;",
    },
  ];
  for (const files of designs) {
    const header = instrumentSource(files, 'r1').elements.find(
      (element) => element.tagName === 'header',
    );
    assert.equal(header?.editability, 'shared', files['main.tsx']);
  }
});

test('names are read by scope, so a React wrapper, a shadowing name or an entry re-export keeps an element editable', () => {
  const designs: SourceFiles[] = [
    {
      'main.tsx':
        "import { memo, forwardRef } from 'react'; const TopBar = memo(forwardRef(() => <header>Title</header>)); export default () => <TopBar />;",
    },
    {
      'main.tsx':
        "import React from 'react'; const TopBar = React.memo((props: { title: React.ReactNode }) => { const [open] = React.useState(false); return <header>Title</header>; }); export default () => <TopBar />;",
    },
    {
      'main.tsx':
        'function Panel({ children }) { const list = [1].map((children) => children); return <section>{list}{children}</section>; } export default () => <Panel><header>Title</header></Panel>;',
    },
    {
      'TopBar.tsx': 'export function TopBar() { return <header>Title</header> }',
      'main.tsx':
        "import { TopBar } from './TopBar'; const labels = { TopBar: 'Top' }; export default TopBar;",
    },
  ];
  for (const files of designs) {
    const header = instrumentSource(files, 'r1').elements.find(
      (element) => element.tagName === 'header',
    );
    assert.equal(header?.editability, 'literal', files['main.tsx']);
  }
});

test('children given to an instance are edited in place only when its component renders them once', () => {
  const panel = (body: string) => `function Panel({ title, children }) { return ${body} }`;
  const cases: [string, SourceElement['editability']][] = [
    [
      `${panel('<section>{children}</section>')} export default () => <Panel><h2>Hi</h2></Panel>`,
      'literal',
    ],
    [
      `${panel('<section>{children}{children}</section>')} export default () => <Panel><h2>Hi</h2></Panel>`,
      'shared',
    ],
    [
      `${panel('<section>{[1, 2].map(() => children)}</section>')} export default () => <Panel><h2>Hi</h2></Panel>`,
      'shared',
    ],
    [
      `${panel('<section>{children}</section>')} export default () => <><Panel><h2>Hi</h2></Panel><Panel /></>`,
      'shared',
    ],
    [
      `${panel('<section>{title}{children}</section>')} export default () => <Panel title={<h2>Hi</h2>} />`,
      'shared',
    ],
    [
      "import { Card } from '@droidex/design-system'; export default () => <Card><h2>Hi</h2></Card>",
      'shared',
    ],
  ];
  for (const [main, scope] of cases) {
    const heading = instrumentSource({ 'main.tsx': main }, 'r1').elements.find(
      (element) => element.tagName === 'h2',
    );
    assert.equal(heading?.editability, scope, main);
  }
});

test('a container of elements is literal, and a computed child still makes it computed', () => {
  const files = {
    'main.tsx':
      'export default () => <main className="p-4"><h1>Hi</h1><img src="canvas-asset:a" /><ul>{items.map((item) => <li>{item}</li>)}</ul></main>',
  };
  assert.deepEqual(editabilityIn(files, 'main.tsx'), [
    ['main', 'literal'],
    ['h1', 'literal'],
    ['img', 'literal'],
    ['ul', 'computed'],
    ['li', 'shared'],
  ]);
  const mapped = instrumentSource(files, 'r1');
  const container = mapped.elements[0];
  assert.ok(container);
  assert.throws(
    () =>
      applyElementEdit(files, mapped.elements, {
        element: reference(container),
        change: { kind: 'text', value: 'Flattened' },
      }),
    (error: unknown) => error instanceof SourceElementError && error.code === 'ambiguous_element',
  );
});
test('fragments and conditional branches retain separate canonical source sites', () => {
  const files = { 'main.tsx': 'export default () => <>{ok ? <h1>Yes</h1> : <h1>No</h1>}</>' };
  const mapped = instrumentSource(files, 'r1');
  assert.equal(mapped.elements.length, 2);
  assert.ok(mapped.elements.every((element) => element.editability === 'literal'));
  const first = mapped.elements[0];
  assert.ok(first);
  const changed = applyElementEdit(files, mapped.elements, {
    element: reference(first),
    change: { kind: 'text', value: 'Sure' },
  });
  assert.equal(changed['main.tsx'], 'export default () => <>{ok ? <h1>Sure</h1> : <h1>No</h1>}</>');
});

test('invalid syntax and authored markers fail before instrumentation can publish an element map', () => {
  for (const source of [
    'export default () => <h1>broken',
    'export default () => <h1 data-droidex-element="fake">Hi</h1>',
  ]) {
    assert.throws(
      () => instrumentSource({ 'main.tsx': source }, 'r1'),
      (error: unknown) => error instanceof SourceElementError && error.code === 'invalid_source',
    );
  }
});

test('image alternatives cannot silently override an owned-image edit', () => {
  for (const markup of [
    '<img src="canvas-asset:old" srcset="canvas-asset:alternate 2x" />',
    '<picture><source srcSet="canvas-asset:alternate" /><img src="canvas-asset:old" /></picture>',
  ]) {
    const files = { 'main.tsx': `export default () => ${markup}` };
    const mapped = instrumentSource(files, 'r1');
    const image = mapped.elements.find((element) => element.tagName === 'img');
    assert.ok(image);
    assert.equal(image.editability, 'computed');
    assert.throws(
      () =>
        applyElementEdit(files, mapped.elements, {
          element: reference(image),
          change: { kind: 'image', assetId: 'after' },
        }),
      (error: unknown) => error instanceof SourceElementError && error.code === 'ambiguous_element',
    );
  }
});

test('syntax diagnostics use canonical UTF-8 byte columns', () => {
  assert.throws(
    () => instrumentSource({ 'main.tsx': 'const π = ;' }, 'r1'),
    (error: unknown) => {
      assert.ok(error instanceof SourceElementError);
      assert.equal(error.code, 'invalid_source');
      assert.equal(error.file, 'main.tsx');
      assert.equal(error.line, 1);
      assert.equal(error.column, Buffer.byteLength('const π = '));
      return true;
    },
  );
});

test('image and style edits cannot introduce an arbitrary image URL or style property', () => {
  const files = {
    'main.tsx':
      'export default () => <img src="canvas-asset:old" style={{color:"var(--ds-text)"}} />',
  };
  const mapped = onlyElement(files);
  for (const [change, code] of [
    [{ kind: 'image', assetId: '../../private' }, 'invalid_edit'],
    [
      { kind: 'style', styles: [{ property: 'backgroundImage', resolution: raw('url(x)') }] },
      'unsupported_edit',
    ],
    [
      { kind: 'style', styles: [{ property: 'a}} onClick={evil} b={{c', resolution: raw('1') }] },
      'unsupported_edit',
    ],
  ] satisfies [SourceChange, string][]) {
    assert.throws(
      () =>
        applyElementEdit(files, mapped.elements, { element: reference(mapped.element), change }),
      (error: unknown) => error instanceof SourceElementError && error.code === code,
    );
  }
});
test('instrumented lines and insertion edges map back to canonical source', () => {
  const source = 'export default function App(){\r\n  return <h1>Hi</h1>;\r\n}';
  const mapped = onlyElement({ 'main.tsx': source });
  const derived = mapped.files['main.tsx'];
  assert.ok(derived);
  const encoded = derived.split('base64,')[1];
  assert.ok(encoded);
  const payload = JSON.parse(Buffer.from(encoded.trim(), 'base64').toString());
  assert.deepEqual(payload.sourcesContent, [source]);
  const map = new SourceMap(payload);
  const generatedLine = derived.split('\r\n')[1];
  assert.ok(generatedLine);
  const entry = map.findEntry(1, generatedLine.indexOf('>Hi'));
  assert.ok('originalSource' in entry);
  assert.equal(entry.originalSource, 'canvas-design:main.tsx');
  assert.equal(entry.originalLine, 1);
  assert.equal(entry.originalColumn, '  return <h1'.length);
  const textEntry = map.findEntry(1, generatedLine.indexOf('Hi'));
  assert.ok('originalColumn' in textEntry);
  assert.equal(textEntry.originalColumn, '  return <h1>'.length);
});

test('dense source reports a selection limit instead of producing a partial element map', () => {
  const source = `export default () => <>${'<i/>'.repeat(CANVAS_LIMITS.maxSourceElements + 1)}</>`;
  assert.throws(
    () => instrumentSource({ 'main.tsx': source }, 'r1'),
    (error: unknown) => {
      assert.ok(error instanceof SourceElementError);
      assert.equal(error.code, 'selection_limit');
      assert.match(error.message, /8,192.*Simplify/);
      return true;
    },
  );
});
