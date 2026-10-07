import assert from 'node:assert/strict';
import { SourceMap } from 'node:module';
import { test } from 'node:test';
import type { ElementEdit, SourceElement, SourceFiles } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';
import { applyElementEdit, instrumentSource, SourceElementError } from './sourceElements.js';

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

test('text, token and image edits return complete changed files without touching surrounding bytes', () => {
  const cases: { markup: string; change: ElementEdit['change']; changed: string }[] = [
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
      change: { kind: 'token', property: 'color', token: '--ds-accent' },
      changed: '<h1 style={{ color: "var(--ds-accent)" }}>Hello</h1>',
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

test('revision, source changes and forged ranges cannot retarget a selection', () => {
  const files = { 'main.tsx': 'export default () => <h1>Hello</h1>' };
  const mapped = onlyElement(files);
  const other = instrumentSource(files, 'r2');
  const edit: ElementEdit = {
    element: reference(mapped.element),
    change: { kind: 'text', value: 'Welcome' },
  };
  for (const [source, elements, request] of [
    [files, other.elements, edit],
    [files, mapped.elements, { ...edit, element: reference(mapped.element, 'r2') }],
    [{ ...files, 'main.tsx': files['main.tsx'].replace('Hello', 'Later') }, mapped.elements, edit],
    [files, [{ ...mapped.element, start: 0 }], edit],
    [files, [mapped.element, mapped.element], edit],
  ] satisfies [SourceFiles, SourceElement[], ElementEdit][]) {
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

test('token and image edits cannot introduce arbitrary style expressions or image URLs', () => {
  const files = {
    'main.tsx':
      'export default () => <img src="canvas-asset:old" style={{color:"var(--ds-text)"}} />',
  };
  const mapped = onlyElement(files);
  for (const change of [
    { kind: 'image', assetId: '../../private' },
    { kind: 'token', property: 'backgroundImage', token: '--ds-accent' },
    { kind: 'token', property: 'color', token: '--ds-accent);evil' },
  ] satisfies ElementEdit['change'][]) {
    assert.throws(
      () =>
        applyElementEdit(files, mapped.elements, { element: reference(mapped.element), change }),
      (error: unknown) => error instanceof SourceElementError && error.code === 'invalid_edit',
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
