import assert from 'node:assert/strict';
import test from 'node:test';
import { isBuild } from '../../../src/features/canvas/buildValidation.js';
import type { SourceFiles } from './protocol.js';
import { sourceOutlineSchema } from './schema.js';
import { instrumentSource } from './sourceElements.js';
import { OUTLINE_BUDGET } from './sourceOutline.js';

/** The outline as indented lines: a tag in brackets, its text, its lock, and `fixed` when it cannot move alone. */
function outlineOf(files: SourceFiles): string[] {
  const { outline } = instrumentSource(files, 'r1');
  const depth = new Map<string | null, number>([[null, -1]]);
  return outline.nodes.map((node) => {
    const level = (depth.get(node.parentId) ?? 0) + 1;
    depth.set(node.nodeId, level);
    const name = node.kind === 'element' ? `<${node.name}>` : node.name;
    const text = node.text === null ? '' : ` "${node.text}"`;
    const lock = node.lock === null ? '' : ` [${node.lock}]`;
    return `${'  '.repeat(level)}${name}${text}${lock}${node.free ? '' : ' fixed'}`;
  });
}

test('the outline follows the root through instances, repeats and conditions in reading order', () => {
  const main = `
    function Card({ title, children }) {
      return <section><h2>{title}</h2>{children}</section>;
    }
    export default function Page({ items, open }) {
      return (
        <main>
          <h1>Hello   there</h1>
          <Card title="One"><p>Inside</p></Card>
          <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
          {open && <aside>Open</aside>}
          {open ? <b>Yes</b> : <i>No</i>}
        </main>
      );
    }`;
  assert.deepEqual(outlineOf({ 'main.tsx': main }), [
    '<main> [computed] fixed',
    '  <h1> "Hello there"',
    '  Card',
    '    <section> [computed] fixed',
    '      <h2> [computed]',
    '      <p> "Inside"',
    '  <ul> [computed]',
    '    Repeat',
    '      <li> [repeated] fixed',
    '  Condition',
    '    <aside> "Open" fixed',
    '  Condition',
    '    <b> "Yes" fixed',
    '    <i> "No" fixed',
  ]);
});

test('rows say why they cannot be edited directly', () => {
  const files = {
    'main.tsx': `
      import { Button } from '@droidex/design-system';
      import { Badge } from './Badge';
      export default () => <div><Badge /><Badge /><Button>Go</Button><img src={url} /></div>;`,
    'Badge.tsx': 'export function Badge() { return <span>New</span> }',
  };
  assert.deepEqual(outlineOf(files), [
    '<div> fixed',
    '  Badge',
    '    <span> "New" [shared] fixed',
    '  Badge',
    '    <span> "New" [shared] fixed',
    '  Button [kit]',
    '  <img> [computed]',
  ]);
});

test('JSX reached through a variable, a local function or a prop opens where it renders', () => {
  const main = `
    function Shell({ icon, children }) { return <div>{icon}{children}</div>; }
    export default function Page({ step }) {
      let body;
      if (step === 1) body = <h1>One</h1>;
      else body = <h2>Two</h2>;
      const footer = <footer>End</footer>;
      function aside() { return <aside>Side</aside>; }
      return <Shell icon={<svg />}>{body}{footer}{aside()}</Shell>;
    }`;
  assert.deepEqual(outlineOf({ 'main.tsx': main }), [
    'Shell fixed',
    '  <svg> [shared] fixed',
    '  <div> [computed] fixed',
    '    Condition',
    '      <h1> "One" [shared] fixed',
    '      <h2> "Two" [shared] fixed',
    '    <footer> "End" [shared] fixed',
    '    <aside> "Side" [shared] fixed',
  ]);
});

test('a component rendering itself, or children twice, still gives every row its own id', () => {
  const main = `
    function Tree() { return <ul><Tree /></ul>; }
    function Twice({ children }) { return <div>{children}{children}</div>; }
    export default () => <><Tree /><Twice><p>Hi</p></Twice></>;`;
  const { outline } = instrumentSource({ 'main.tsx': main }, 'r1');
  assert.deepEqual(outlineOf({ 'main.tsx': main }), [
    'Tree',
    '  <ul> [shared] fixed',
    '    Tree [shared]',
    'Twice',
    '  <div> [computed] fixed',
    '    <p> "Hi" [shared]',
    '    <p> "Hi" [shared]',
  ]);
  assert.equal(new Set(outline.nodes.map((node) => node.nodeId)).size, outline.nodes.length);
  assert.equal(outline.truncated, false);
});

test('long text is clamped, and nesting past the open depth is reported as truncated', () => {
  const long = 'x'.repeat(80);
  const chain = Array.from(
    { length: 15 },
    (_, index) => `function C${String(index)}() { return <C${String(index + 1)} />; }`,
  ).join('\n');
  const main = `${chain}\nfunction C15() { return <p>${long}</p>; }\nexport default () => <C0 />;`;
  const { outline } = instrumentSource({ 'main.tsx': main }, 'r1');
  assert.equal(outline.truncated, true);
  assert.equal(
    outline.nodes.some((node) => node.kind === 'element'),
    false,
  );

  const [paragraph] = instrumentSource({ 'main.tsx': `export default () => <p>${long}</p>;` }, 'r1')
    .outline.nodes;
  assert.equal(paragraph?.text, `${'x'.repeat(63)}…`);
});

test('a small source that would expand past the budget stops with a partial outline marked truncated', () => {
  // Every level renders the next twice, so 15 KB of source opens 2,048 instances of a long name.
  const name = `Long${'A'.repeat(5000)}`;
  const doubling = Array.from({ length: 11 }, (_, index) => {
    const child = index === 10 ? name : `C${String(index + 1)}`;
    return `function C${String(index)}() { return <><${child} /><${child} /></>; }`;
  });
  // Every helper has two returns, each calling the next.
  const helpers = Array.from(
    { length: 16 },
    (_, index) =>
      `function f${String(index)}() { if (Math.random()) return f${String(index + 1)}(); return f${String(index + 1)}(); }`,
  );
  const designs = [
    `function ${name}() { return <span />; }\n${doubling.join('\n')}\nexport default () => <C0 />;`,
    `${helpers.join('\n')}\nfunction f16() { return <span />; }\nexport default () => f0();`,
  ];
  for (const main of designs) {
    const { outline } = instrumentSource({ 'main.tsx': main }, 'r1');
    assert.equal(outline.truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(outline)) <= OUTLINE_BUDGET.bytes);
    assert.ok(outline.nodes.every((node) => Array.from(node.name).length <= 64));
    assert.equal(sourceOutlineSchema.safeParse(outline).success, true);
  }
});

test('row ids follow where JSX is written, so editing text or adding an import above keeps them', () => {
  const ids = (main: string) =>
    instrumentSource({ 'main.tsx': main }, 'r1').outline.nodes.map((node) => node.nodeId);
  const before = ids(
    'export default () => <main><h1>Short</h1><section><p>Same</p></section></main>;',
  );
  const after = ids(
    "import './styles.css';\nexport default () =>\n  <main><h1>Much longer text</h1><section><p>Same</p></section></main>;",
  );
  assert.equal(before.length, 4);
  assert.deepEqual(after, before);
});

test('JSX that renders through other forms still gets rows, and JSX that never renders gets none', () => {
  const cases: [SourceFiles, string[]][] = [
    [
      {
        'main.tsx':
          'export default ({ open }) => { const body = <h1>Shown</h1>; return open ? body : null; }',
      },
      ['Condition fixed', '  <h1> "Shown" [shared] fixed'],
    ],
    [
      {
        'main.tsx': "import * as C from './Card'; export default () => <C.Card />;",
        'Card.tsx': 'export function Card() { return <p>Card</p>; }',
      },
      ['C.Card fixed', '  <p> "Card" [shared] fixed'],
    ],
    [
      {
        'main.tsx':
          'function Shell({ children: body, data }) { return <section>{data.children}{body}</section>; }\nexport default () => <Shell data={{}}><b>Given</b></Shell>;',
      },
      ['Shell fixed', '  <section> [computed] fixed', '    <b> "Given" [shared]'],
    ],
    [
      {
        'main.tsx':
          'function Shell({ children, ...rest }) { return <section>{rest.children}{children}</section>; }\nexport default () => <Shell><b>Given</b></Shell>;',
      },
      ['Shell fixed', '  <section> [computed] fixed', '    <b> "Given"'],
    ],
    [
      {
        'main.tsx': "import { Card } from './ui/Card'; export default () => <Card />;",
        'ui/Card.tsx': "import { Label } from '..'; export function Card() { return <Label />; }",
        'index.tsx': 'export function Label() { return <b>Label</b>; }',
      },
      ['Card fixed', '  Label fixed', '    <b> "Label" fixed'],
    ],
    [
      {
        'main.tsx':
          'export default ({ a }) => <main>{<h1>Left</h1> ?? a}{a || <p>Right</p>}</main>;',
      },
      [
        '<main> [computed] fixed',
        '  Condition',
        '    <h1> "Left" fixed',
        '  Condition',
        '    <p> "Right" fixed',
      ],
    ],
    [
      {
        'main.tsx':
          'import { createPortal } from \'react-dom\';\nexport default () => [<h1 key="a">One</h1>, createPortal(<aside>Two</aside>, document.body)];',
      },
      ['<h1> "One" [shared] fixed', '<aside> "Two" [shared] fixed'],
    ],
    [
      {
        'main.tsx':
          "import { createPortal as portal } from 'react-dom';\nexport default () => portal(<aside>Two</aside>, document.body);",
      },
      ['<aside> "Two" [shared] fixed'],
    ],
    [
      {
        'main.tsx':
          'function Item(item) { return <li>{item}</li>; }\nexport default ({ items }) => <ul>{items.map(Item)}</ul>;',
      },
      ['<ul> [computed] fixed', '  Repeat', '    <li> [repeated] fixed'],
    ],
    [
      {
        'main.tsx':
          'export default ({ ready }) => { let body = <p>Now</p>; const later = () => { body = <b>Never</b>; }; if (!ready) return null; return <main>{body}</main>; }',
      },
      ['<main> [computed] fixed', '  <p> "Now" [shared] fixed'],
    ],
    [
      {
        'main.tsx':
          'export default ({ step }) => { if (step) { var body = <h1>One</h1>; } else { body = <h2>Two</h2>; } return <main>{body}</main>; }',
      },
      [
        '<main> [computed] fixed',
        '  Condition',
        '    <h1> "One" [shared] fixed',
        '    <h2> "Two" [shared] fixed',
      ],
    ],
    [
      {
        'main.tsx':
          'export default function Page({ data }) { if (!data) return <p>Loading</p>; return <main>Ready</main>; }',
      },
      ['Condition fixed', '  <p> "Loading" fixed', '  <main> "Ready" fixed'],
    ],
  ];
  for (const [files, expected] of cases)
    assert.deepEqual(outlineOf(files), expected, files['main.tsx']);
});

test('both validators take an outline only as a tree of bounded one-line rows', () => {
  const root = {
    nodeId: '0123456789abcdef',
    parentId: null,
    kind: 'instance',
    name: 'Card',
    text: null,
    elementId: null,
    lock: null,
    free: false,
  };
  const child = { ...root, nodeId: 'fedcba9876543210', parentId: root.nodeId };
  const accepts = (nodes: unknown[]) => {
    const outline = { nodes, truncated: false };
    const sidecar = sourceOutlineSchema.safeParse(outline).success;
    const build = {
      status: 'ready',
      revisionId: 'r1',
      artifactId: 'a1',
      elements: [],
      diagnostics: [],
    };
    assert.equal(isBuild({ ...build, outline, generation: 1 }), sidecar, JSON.stringify(nodes));
    return sidecar;
  };
  assert.equal(accepts([root, child]), true);
  assert.equal(accepts([{ ...root, name: '😀'.repeat(64) }]), true);
  for (const nodes of [
    [root, root],
    [child, root],
    [{ ...root, parentId: root.nodeId }],
    [{ ...root, elementId: 'el_1' }],
    [{ ...root, kind: 'element' }],
    [{ ...root, text: 'Not an element' }],
    [{ ...root, name: '😀'.repeat(65) }],
    [{ ...root, name: 'Two\nlines' }],
  ])
    assert.equal(accepts(nodes), false);
});
