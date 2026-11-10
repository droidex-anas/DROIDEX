import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceFiles } from './protocol.js';
import { instrumentSource } from './sourceElements.js';

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
