import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceFiles } from './protocol.js';
import { instrumentSource } from './sourceElements.js';
import { moveLayer, type LayerMove } from './sourceStructureEdits.js';

/** The id of the first outline row with this name, in reading order. */
function rowId(files: SourceFiles, name: string): string {
  const row = instrumentSource(files, 'r1').outline.nodes.find((node) => node.name === name);
  assert.ok(row, `no row named ${name}`);
  return row.nodeId;
}

function moveOf(files: SourceFiles, subject: string, parent: string, before: string | null) {
  return {
    nodeId: rowId(files, subject),
    parentId: rowId(files, parent),
    beforeId: before === null ? null : rowId(files, before),
  };
}

/** Moves the row named `subject` and returns the edited main.tsx, checking the result still maps and names where it landed. */
function moved(main: string, subject: string, parent: string, before: string | null = null) {
  const files = { 'main.tsx': main };
  const result = moveLayer(files, moveOf(files, subject, parent, before));
  assert.deepEqual(Object.keys(result.files), ['main.tsx']);
  const after = instrumentSource({ ...files, ...result.files }, 'r2');
  assert.equal(after.elements.length, instrumentSource(files, 'r1').elements.length);
  const landed = after.outline.nodes.find((node) => node.nodeId === result.landed);
  assert.equal(landed?.name, subject);
  return result.files['main.tsx'];
}

test('a layer moves among its siblings on lines of their own, or inline where they are inline', () => {
  const main = `export default () => (
  <main>
    <section className="flex flex-col gap-4">
      <h1>Pricing</h1>
      <p>Simple plans.</p>
    </section>
  </main>
);
`;
  const swapped = `export default () => (
  <main>
    <section className="flex flex-col gap-4">
      <p>Simple plans.</p>
      <h1>Pricing</h1>
    </section>
  </main>
);
`;
  assert.equal(moved(main, 'p', 'section', 'h1'), swapped);
  assert.equal(moved(main, 'h1', 'section'), swapped);
  assert.equal(
    moved('export default () => <main><h1>A</h1><p>B</p></main>;', 'p', 'main', 'h1'),
    'export default () => <main><p>B</p><h1>A</h1></main>;',
  );
});

test('an instance moves into a self-closing element, which opens to hold it', () => {
  const main = `function Badge({ children }) { return <span>{children}</span>; }
export default () => (
  <main>
    <div className="flex" />
    <Badge>New</Badge>
  </main>
);
`;
  assert.equal(
    moved(main, 'Badge', 'div'),
    `function Badge({ children }) { return <span>{children}</span>; }
export default () => (
  <main>
    <div className="flex">
      <Badge>New</Badge>
    </div>
  </main>
);
`,
  );
});

test('a condition moves into another element after its last child', () => {
  const main = `export default ({ open }) => (
  <main>
    <header>
      <h1>Title</h1>
    </header>
    {open && <aside>Open</aside>}
  </main>
);
`;
  assert.equal(
    moved(main, 'Condition', 'header'),
    `export default ({ open }) => (
  <main>
    <header>
      <h1>Title</h1>
      {open && <aside>Open</aside>}
    </header>
  </main>
);
`,
  );
});

test('a layer and a list move past each other whole', () => {
  const main = `export default ({ items }) => (
  <ul>
    <li>First</li>
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
  </ul>
);
`;
  const after = `export default ({ items }) => (
  <ul>
    {items.map((item) => (
      <li key={item}>{item}</li>
    ))}
    <li>First</li>
  </ul>
);
`;
  assert.equal(moved(main, 'li', 'ul'), after);
  assert.equal(moved(main, 'Repeat', 'ul', 'li'), after);
});

test('a moved layer takes the indentation of its new place, in tabs or spaces, and keeps CRLF', () => {
  const tabs = [
    'export default () => (',
    '\t<main>',
    '\t\t<section>',
    '\t\t\t<h1>Title</h1>',
    '\t\t</section>',
    '\t\t<footer>',
    '\t\t\t<p>End</p>',
    '\t\t</footer>',
    '\t</main>',
    ');',
  ];
  assert.equal(
    moved(tabs.join('\n'), 'footer', 'section'),
    [
      ...tabs.slice(0, 4),
      '\t\t\t<footer>',
      '\t\t\t\t<p>End</p>',
      '\t\t\t</footer>',
      '\t\t</section>',
      ...tabs.slice(8),
    ].join('\n'),
  );

  const spaces = [
    'export default () => (',
    '    <main>',
    '        <section />',
    '        <footer>',
    '            <p>End</p>',
    '        </footer>',
    '    </main>',
    ');',
    '',
  ];
  assert.equal(
    moved(spaces.join('\r\n'), 'footer', 'section'),
    [
      ...spaces.slice(0, 2),
      '        <section>',
      '            <footer>',
      '                <p>End</p>',
      '            </footer>',
      '        </section>',
      ...spaces.slice(6),
    ].join('\r\n'),
  );
});

test('a move that is not one cut and paste within a component is refused with the reason', () => {
  const files = {
    'main.tsx': `function Badge({ children }) { return <span>{children}</span>; }
function Pair() { return <div><s>Twice</s></div>; }
export default ({ items, open }) => (
  <main>
    <section>
      <h1>Title</h1>
      <img src="a.png" />
    </section>
    <p>Hello <b>world</b></p>
    <Badge icon={<em>Tip</em>}><i>In</i></Badge>
    <Pair />
    <Pair />
    <ol>{items.map((item) => <li key={item}><u>{item}</u></li>)}</ol>
    {open && <aside>Open</aside>}
  </main>
);
`,
  };
  const stale = 'stale_reference';
  const cases: [Partial<LayerMove> | [string, string, string | null], string, string][] = [
    [
      { nodeId: 'unknown' },
      stale,
      'This selection belongs to different source. Reselect the element in the current revision.',
    ],
    [
      { beforeId: 'unknown' },
      stale,
      'This selection belongs to different source. Reselect the element in the current revision.',
    ],
    [['main', 'section', null], 'invalid_edit', "A frame's top layer can't move."],
    [
      ['em', 'section', null],
      'ambiguous_element',
      'This layer is written inside code (a list, a condition or a prop). Ask the agent to move it.',
    ],
    [
      ['aside', 'section', null],
      'ambiguous_element',
      'This layer is written inside code (a list, a condition or a prop). Ask the agent to move it.',
    ],
    [
      ['u', 'section', null],
      'ambiguous_element',
      'Written once and repeated for each item. Ask the agent to change it.',
    ],
    [
      ['s', 'section', null],
      'ambiguous_element',
      'Used in several places. Ask the agent to change it.',
    ],
    [['h1', 'img', null], 'invalid_edit', "This layer can't hold other layers."],
    [['h1', 'Badge', null], 'invalid_edit', "This layer can't hold other layers."],
    [['h1', 'Condition', null], 'invalid_edit', "This layer can't hold other layers."],
    [['section', 'h1', null], 'invalid_edit', "A layer can't move into itself."],
    [
      ['h1', 'span', null],
      'invalid_edit',
      "Layers can move only within the component they're written in.",
    ],
    [['img', 'main', 'h1'], 'invalid_edit', "A layer can't go there."],
    [['h1', 'section', 'h1'], 'invalid_edit', "A layer can't go there."],
    [['b', 'main', null], 'invalid_edit', 'This layer sits inside text. Edit the text instead.'],
    [['h1', 'p', null], 'invalid_edit', 'This layer sits inside text. Edit the text instead.'],
    [['h1', 'section', 'img'], 'invalid_edit', 'The layer is already there.'],
    [['img', 'section', null], 'invalid_edit', 'The layer is already there.'],
  ];
  const base = moveOf(files, 'h1', 'main', null);
  for (const [change, code, message] of cases) {
    const move = Array.isArray(change) ? moveOf(files, ...change) : { ...base, ...change };
    assert.throws(() => moveLayer(files, move), { code, message }, JSON.stringify(change));
  }
});

test('a moved layer keeps the lines of its strings and templates as written', () => {
  const main = `export default () => (
  <main>
    <section />
    <pre title="a
    b">{\`first
    second\`}</pre>
  </main>
);
`;
  assert.equal(
    moved(main, 'pre', 'section'),
    `export default () => (
  <main>
    <section>
      <pre title="a
    b">{\`first
    second\`}</pre>
    </section>
  </main>
);
`,
  );
});

test('a move that would change what the source means is refused with the reason', () => {
  const text = 'This layer sits inside text. Edit the text instead.';
  const prop = "This layer's content is set by a prop, so it can't hold other layers.";
  const cases: [string, string, string, string, string][] = [
    [
      `export default ({ flag }) => {
  if (flag) {
    const label = 'Scoped';
    return <main><span>{label}</span></main>;
  }
  return <section />;
};`,
      'span',
      'section',
      'ambiguous_element',
      'This layer and that place are in different blocks of code. Ask the agent to move it.',
    ],
    ['export default () => <main><pre>   </pre><i>A</i></main>;', 'i', 'pre', 'invalid_edit', text],
    [
      'export default () => <main><p> <b>A</b></p><i>B</i></main>;',
      'b',
      'main',
      'invalid_edit',
      text,
    ],
    [
      'export default ({ html }) => <main><div dangerouslySetInnerHTML={{ __html: html }} /><i>A</i></main>;',
      'i',
      'div',
      'invalid_edit',
      prop,
    ],
    [
      'export default () => <main><div children="Set" /><i>A</i></main>;',
      'i',
      'div',
      'invalid_edit',
      prop,
    ],
  ];
  for (const [main, subject, parent, code, message] of cases) {
    const files = { 'main.tsx': main };
    assert.throws(
      () => moveLayer(files, moveOf(files, subject, parent, null)),
      { code, message },
      main,
    );
  }
});
