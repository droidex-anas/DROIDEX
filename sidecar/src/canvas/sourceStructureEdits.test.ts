import assert from 'node:assert/strict';
import test from 'node:test';
import type { SourceFiles } from './protocol.js';
import { instrumentSource } from './sourceElements.js';
import { editLayer, moveLayer, type LayerMove } from './sourceStructureEdits.js';

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

  // A layer indented unlike its new place takes the place's step, not its own.
  const mixed = [
    'export default () => (',
    '  <main>',
    '    <section />',
    '\t\t<p>End</p>',
    '  </main>',
    ');',
  ];
  assert.equal(
    moved(mixed.join('\n'), 'p', 'section'),
    [
      ...mixed.slice(0, 2),
      '    <section>',
      '      <p>End</p>',
      '    </section>',
      ...mixed.slice(4),
    ].join('\n'),
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
      'Used in several places. Ask the agent to change it.',
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
  const prop = "This layer's props may set its content, so it can't hold other layers.";
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

/** The ids of the outline rows with this name, in reading order. */
function rowIds(files: SourceFiles, name: string): string[] {
  const rows = instrumentSource(files, 'r1').outline.nodes.filter((node) => node.name === name);
  return rows.map((node) => node.nodeId);
}

/** Removes the `nth` row named `subject`; returns the edited main.tsx and the label of the row landed on. */
function removed(main: string, subject: string, nth = 0) {
  const files = { 'main.tsx': main };
  const result = editLayer(files, rowIds(files, subject)[nth], { kind: 'remove' });
  assert.deepEqual(Object.keys(result.files), ['main.tsx']);
  const after = instrumentSource({ ...files, ...result.files }, 'r2');
  const row = after.outline.nodes.find((node) => node.nodeId === result.landed);
  return { main: result.files['main.tsx'], landed: row && (row.text ?? row.name) };
}

/** Copies the `nth` row named `subject`, checking the row landed on is the copy, next of that name. */
function duplicated(main: string, subject: string, nth = 0): string {
  const files = { 'main.tsx': main };
  const result = editLayer(files, rowIds(files, subject)[nth], { kind: 'duplicate' });
  assert.deepEqual(Object.keys(result.files), ['main.tsx']);
  assert.equal(result.landed, rowIds({ ...files, ...result.files }, subject)[nth + 1]);
  return result.files['main.tsx'];
}

const LIST = `export default () => (
  <ul>
    <li>Fast</li>
    <li>Cheap</li>
  </ul>
);
`;

test('a removed layer takes its line, and the keyboard goes to the row after it, else before, else its parent', () => {
  assert.deepEqual(removed(LIST, 'li', 1), {
    main: `export default () => (
  <ul>
    <li>Fast</li>
  </ul>
);
`,
    landed: 'Fast',
  });
  assert.deepEqual(removed(LIST, 'li', 0).landed, 'Cheap');
  assert.deepEqual(
    removed(
      `export default () => (
  <main>
    <ul>
      <li>Only</li>
    </ul>
  </main>
);
`,
      'li',
    ),
    {
      main: `export default () => (
  <main>
    <ul></ul>
  </main>
);
`,
      landed: 'ul',
    },
  );
  assert.deepEqual(
    removed('export default () => <main><h1>A</h1><p>Hi <b>B</b></p></main>;', 'b'),
    {
      main: 'export default () => <main><h1>A</h1><p>Hi </p></main>;',
      landed: 'Hi',
    },
  );
});

test('removing an instance removes its usage and keeps the component it renders', () => {
  const main = `function Badge({ children }) { return <span>{children}</span>; }
export default () => (
  <main>
    <h1>Title</h1>
    <Badge>New</Badge>
  </main>
);
`;
  assert.deepEqual(removed(main, 'Badge'), {
    main: `function Badge({ children }) { return <span>{children}</span>; }
export default () => (
  <main>
    <h1>Title</h1>
  </main>
);
`,
    landed: 'Title',
  });
});

test('a copy goes right after its layer, on a line of its own where the layer has one', () => {
  assert.equal(
    duplicated(LIST, 'li'),
    `export default () => (
  <ul>
    <li>Fast</li>
    <li>Fast</li>
    <li>Cheap</li>
  </ul>
);
`,
  );
  assert.equal(
    duplicated('export default () => <main><h1>A</h1><p>B</p></main>;', 'h1'),
    'export default () => <main><h1>A</h1><h1>A</h1><p>B</p></main>;',
  );
  const crlf = [
    'export default ({ open }) => (',
    '  <main>',
    '    {open && (',
    '      <aside>Open</aside>',
    '    )}',
    '  </main>',
    ');',
  ];
  assert.equal(
    duplicated(crlf.join('\r\n'), 'Condition'),
    [...crlf.slice(0, 5), ...crlf.slice(2, 5), ...crlf.slice(5)].join('\r\n'),
  );
});

test('a removal or copy that is not of one JSX child written once is refused with the reason', () => {
  const files = {
    'main.tsx': `function Badge({ icon }) { return <span>{icon}</span>; }
function Pair() { return <div><s>Twice</s></div>; }
export default ({ items, open }) => (
  <main>
    <h1 id="title">Title</h1>
    <section><h2 id="more">More</h2></section>
    <Pair />
    <Pair />
    <Badge icon={<em>Tip</em>} />
    <ol>{items.map((item) => <li key={item}><u>{item}</u></li>)}</ol>
    {open && <aside>Open</aside>}
  </main>
);
`,
  };
  const cases: [string, 'remove' | 'duplicate', string, string][] = [
    [
      'unknown',
      'remove',
      'stale_reference',
      'This selection belongs to different source. Reselect the element in the current revision.',
    ],
    [
      'main',
      'remove',
      'invalid_edit',
      "A frame's top layer can't be deleted. Delete the frame instead.",
    ],
    [
      'main',
      'duplicate',
      'invalid_edit',
      "A frame's top layer can't be duplicated. Duplicate the frame instead.",
    ],
    [
      'aside',
      'remove',
      'ambiguous_element',
      'This layer is written inside code (a list, a condition or a prop). Ask the agent to delete it.',
    ],
    [
      'aside',
      'duplicate',
      'ambiguous_element',
      'This layer is written inside code (a list, a condition or a prop). Ask the agent to duplicate it.',
    ],
    ['em', 'remove', 'ambiguous_element', 'Used in several places. Ask the agent to change it.'],
    [
      'u',
      'remove',
      'ambiguous_element',
      'Written once and repeated for each item. Ask the agent to change it.',
    ],
    ['s', 'duplicate', 'ambiguous_element', 'Used in several places. Ask the agent to change it.'],
    ['div', 'remove', 'ambiguous_element', 'Used in several places. Ask the agent to change it.'],
    ['h1', 'duplicate', 'invalid_edit', 'This layer has an id, and a copy would repeat it.'],
    ['section', 'duplicate', 'invalid_edit', 'This layer has an id, and a copy would repeat it.'],
  ];
  for (const [subject, kind, code, message] of cases) {
    const nodeId = subject === 'unknown' ? '0000000000000000' : rowId(files, subject);
    assert.throws(
      () => editLayer(files, nodeId, { kind }),
      { code, message },
      `${kind} ${subject}`,
    );
  }
});

test('a copy that would repeat a key, a ref or an id props may set is refused, as is deleting a frame’s last top layer', () => {
  const files = {
    'main.tsx': `import { useRef } from 'react';
const props = { id: 'name' };
export default () => {
  const ref = useRef(null);
  return (
    <main>
      <p key="one">One</p>
      <input {...props} />
      <label><input ref={ref} /></label>
      <ul>{[1, 2].map((n) => <li key={n}>{n}</li>)}</ul>
    </main>
  );
};
`,
  };
  const cases: [string, string, string][] = [
    [
      'p',
      'invalid_edit',
      'This layer has a key, and a copy would repeat it. Ask the agent to duplicate it.',
    ],
    [
      'input',
      'ambiguous_element',
      'This layer takes props from code, which may set an id a copy would repeat. Ask the agent to duplicate it.',
    ],
    [
      'label',
      'invalid_edit',
      'This layer has a ref, which a copy would take over. Ask the agent to duplicate it.',
    ],
  ];
  for (const [subject, code, message] of cases)
    assert.throws(
      () => editLayer(files, rowId(files, subject), { kind: 'duplicate' }),
      { code, message },
      subject,
    );
  // Each list keys its own items, so a copy of the list repeats none among its siblings.
  assert.doesNotThrow(() => editLayer(files, rowId(files, 'ul'), { kind: 'duplicate' }));

  // A fragment holding a frame's top layers: one of several goes, the last stays, and either copies.
  assert.equal(
    removed('export default () => <><main>Root</main><footer>Foot</footer></>;', 'footer').main,
    'export default () => <><main>Root</main></>;',
  );
  const alone = { 'main.tsx': 'export default () => <><main>Root</main></>;' };
  assert.throws(() => editLayer(alone, rowId(alone, 'main'), { kind: 'remove' }), {
    code: 'invalid_edit',
    message: "A frame's top layer can't be deleted. Delete the frame instead.",
  });
  assert.equal(
    duplicated(alone['main.tsx'], 'main'),
    'export default () => <><main>Root</main><main>Root</main></>;',
  );
});

/** Hides or shows the row named `subject`, checking it lands on that row; returns the edited main.tsx. */
function hidden(main: string, subject: string, hide = true): string {
  const files = { 'main.tsx': main };
  const nodeId = rowId(files, subject);
  const result = editLayer(files, nodeId, { kind: 'hide', hidden: hide });
  const after = instrumentSource({ ...files, ...result.files }, 'r2').outline.nodes;
  assert.equal(after.find((node) => node.nodeId === result.landed)?.hidden, hide);
  assert.equal(result.landed, nodeId);
  return result.files['main.tsx'];
}

test('hiding writes a bare hidden first among the attributes, and showing takes it away with its line', () => {
  const main =
    'export default () => <main><aside className="flex gap-2">Side</aside><hr /></main>;';
  const hiddenMain =
    'export default () => <main><aside hidden className="flex gap-2">Side</aside><hr /></main>;';
  assert.equal(hidden(main, 'aside'), hiddenMain);
  assert.equal(hidden(hiddenMain, 'aside', false), main);
  assert.equal(
    hidden(main, 'hr'),
    'export default () => <main><aside className="flex gap-2">Side</aside><hr hidden /></main>;',
  );
  assert.equal(
    hidden('export default () => <main><p className="a" hidden>B</p></main>;', 'p', false),
    'export default () => <main><p className="a">B</p></main>;',
  );

  const lines = `export default () => (
  <main>
    <aside
      className="flex"
      title="Side"
    >
      Side
    </aside>
  </main>
);
`;
  const hiddenLines = lines.replace(
    '<aside\n      className',
    '<aside\n      hidden\n      className',
  );
  assert.equal(hidden(lines, 'aside'), hiddenLines);
  assert.equal(hidden(hiddenLines, 'aside', false), lines);
});

test('hiding is refused where code decides whether the layer shows, or the layer is not free to change', () => {
  const files = {
    'main.tsx': `function Card() { return <article>Card</article>; }
export default ({ open, items }) => (
  <main>
    <p hidden={open}>Open</p>
    <h2 hidden="">Title</h2>
    <Card />
    <Card />
    <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
    {open && <aside>Open</aside>}
    <section />
  </main>
);
`,
  };
  const code = 'Whether this layer shows is worked out in code. Ask the agent.';
  const cases: [string, string, string][] = [
    ['p', 'ambiguous_element', code],
    ['h2', 'ambiguous_element', code],
    ['main', 'invalid_edit', "A frame's top layer can't be hidden. Hide the frame instead."],
    ['Card', 'invalid_edit', 'Only an element can be hidden.'],
    ['article', 'ambiguous_element', 'Used in several places. Ask the agent to change it.'],
    [
      'li',
      'ambiguous_element',
      'Written once and repeated for each item. Ask the agent to change it.',
    ],
    [
      'aside',
      'ambiguous_element',
      'This layer is written inside code (a list, a condition or a prop). Ask the agent to hide it.',
    ],
  ];
  for (const [subject, errorCode, message] of cases)
    assert.throws(
      () => editLayer(files, rowId(files, subject), { kind: 'hide', hidden: true }),
      { code: errorCode, message },
      subject,
    );
  assert.throws(() => editLayer(files, rowId(files, 'section'), { kind: 'hide', hidden: false }), {
    code: 'invalid_edit',
    message: 'The layer already shows.',
  });
});
