import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogEntry } from './kitCatalog.js';
import type { SourceFiles } from './protocol.js';
import { SourceElementError } from './sourceElementError.js';
import { instrumentSource } from './sourceElements.js';
import { insertLayer } from './sourceInsert.js';

const BUTTON: CatalogEntry = {
  name: 'Button',
  module: 'index.tsx',
  uses: ['Button'],
  icons: [],
  jsx: '<Button>Continue</Button>',
  note: null,
};

const CARD: CatalogEntry = {
  ...BUTTON,
  name: 'Card',
  uses: ['Card', 'Button'],
  jsx: `<Card>
  <h2>Weekly summary</h2>
  <Button>Review now</Button>
</Card>`,
};

const KIT = "import { Button } from '@droidex/design-system';\n";

/** The id of the first outline row with this name, in reading order. */
function rowId(files: SourceFiles, name: string): string {
  const row = instrumentSource(files, 'r1').outline.nodes.find((node) => node.name === name);
  assert.ok(row, `no row named ${name}`);
  return row.nodeId;
}

/** Adds `entry` to the row named `target` and returns main.tsx, checking it still maps with the added rows and lands on the entry. */
function inserted(main: string, target: string, entry = BUTTON): string {
  const files = { 'main.tsx': main };
  const result = insertLayer(files, rowId(files, target), entry);
  const after = instrumentSource({ ...files, ...result.files }, 'r2').outline.nodes;
  const before = instrumentSource(files, 'r1').outline.nodes;
  assert.ok(after.length > before.length);
  assert.equal(after.find((node) => node.nodeId === result.landed)?.name, entry.uses[0]);
  return result.files['main.tsx'];
}

function refusal(main: string, target: string, entry = BUTTON): string {
  const files = { 'main.tsx': main };
  try {
    insertLayer(files, rowId(files, target), entry);
  } catch (error) {
    assert.ok(error instanceof SourceElementError);
    return error.message;
  }
  assert.fail('the insert was not refused');
}

test('an entry goes last inside a layer that holds others, on a line of its own', () => {
  const main = `${KIT}export default () => (
  <main>
    <section className="flex flex-col gap-4">
      <h1>Pricing</h1>
    </section>
  </main>
);
`;
  assert.equal(
    inserted(main, 'section'),
    `${KIT}export default () => (
  <main>
    <section className="flex flex-col gap-4">
      <h1>Pricing</h1>
      <Button>Continue</Button>
    </section>
  </main>
);
`,
  );
});

test('an empty element and a self-closing one open to take the entry, indented one step in', () => {
  assert.equal(
    inserted(`${KIT}export default () => (\n  <main>\n    <div></div>\n  </main>\n);\n`, 'div'),
    `${KIT}export default () => (\n  <main>\n    <div>\n      <Button>Continue</Button>\n    </div>\n  </main>\n);\n`,
  );
  assert.equal(
    inserted(`${KIT}export default () => <main />;\n`, 'main'),
    `${KIT}export default () => <main>\n  <Button>Continue</Button>\n</main>;\n`,
  );
});

test('a layer holding text or nothing takes the entry right after it', () => {
  const main = `${KIT}export default () => (
  <main>
    <p>Simple plans.</p>
    <img src="/hero.png" alt="" />
  </main>
);
`;
  assert.equal(
    inserted(main, 'p'),
    main.replace('<p>Simple plans.</p>', '<p>Simple plans.</p>\n    <Button>Continue</Button>'),
  );
  assert.equal(
    inserted(main, 'img'),
    main.replace('alt="" />', 'alt="" />\n    <Button>Continue</Button>'),
  );
  assert.equal(
    inserted(`${KIT}export default () => <main><p>A</p></main>;`, 'p'),
    `${KIT}export default () => <main><p>A</p><Button>Continue</Button></main>;`,
  );
});

test("an entry of several lines takes the file's tabs and CRLF line endings", () => {
  const main = `import { Button, Card } from '@droidex/design-system';\r\nexport default () => (\r\n\t<main>\r\n\t\t<div />\r\n\t</main>\r\n);\r\n`;
  assert.equal(
    inserted(main, 'main', CARD),
    `import { Button, Card } from '@droidex/design-system';\r\nexport default () => (\r\n\t<main>\r\n\t\t<div />\r\n\t\t<Card>\r\n\t\t\t<h2>Weekly summary</h2>\r\n\t\t\t<Button>Review now</Button>\r\n\t\t</Card>\r\n\t</main>\r\n);\r\n`,
  );
});

test('the names an entry uses are imported once, and the row found past them', () => {
  assert.equal(
    inserted('export default () => <main />;\n', 'main', CARD),
    "import { Card, Button } from '@droidex/design-system';\n\nexport default () => <main>\n  <Card>\n    <h2>Weekly summary</h2>\n    <Button>Review now</Button>\n  </Card>\n</main>;\n",
  );
});

test('a layer holding only a string in braces holds text, so the entry goes after it', () => {
  assert.equal(
    inserted(`${KIT}export default () => <main><section>{"Hello"}</section></main>;`, 'section'),
    `${KIT}export default () => <main><section>{"Hello"}</section><Button>Continue</Button></main>;`,
  );
});

test('a layer holding only an empty string in braces holds no text, so the entry goes inside it', () => {
  assert.equal(
    inserted(`${KIT}export default () => <main><section>{""}</section></main>;`, 'section'),
    `${KIT}export default () => <main><section>{""}\n  <Button>Continue</Button>\n</section></main>;`,
  );
});

test('an element written inside a condition does not take the entry, though it could hold it', () => {
  assert.equal(
    refusal(`${KIT}export default () => <main>{true && <section />}</main>;`, 'section'),
    'This layer is written inside code (a list, a condition or a prop). Ask the agent to add to it.',
  );
});

test('an entry giving an element an id the frame already gives one is refused, naming the id', () => {
  const email: CatalogEntry = {
    ...BUTTON,
    name: 'Email',
    uses: [],
    jsx: '<div>\n  <label htmlFor="email">Email</label>\n  <input id="email" />\n</div>',
  };
  assert.equal(
    refusal('export default () => <main><input id="email" /></main>;', 'main', email),
    'This frame already has an element with id "email", and the entry would repeat it.',
  );
  // The document reads the id, not how the source spells it.
  for (const spelled of ['"em&#97;il"', '"em&#x61;il"', '{("email")}'])
    assert.equal(
      refusal(`export default () => <main><input id=${spelled} /></main>;`, 'main', email),
      'This frame already has an element with id "email", and the entry would repeat it.',
    );
  assert.equal(
    refusal('export default () => <main><input id="&eacute;mail" /></main>;', 'main', email),
    "This frame writes an id the edit can't read, so the entry's id might repeat it.",
  );
  const files = { 'main.tsx': 'export default () => <main><input id="e&amp;mail" /></main>;' };
  assert.ok(insertLayer(files, rowId(files, 'main'), email).landed);
});

test('a layer the edit cannot reach alone is refused with the reason', () => {
  assert.equal(
    refusal(`${KIT}export default () => <h1>Pricing</h1>;`, 'h1'),
    "This frame's top layer holds text. Pick a layer that holds others.",
  );
  assert.equal(
    refusal(
      `${KIT}export default ({ items }) => <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>;`,
      'li',
    ),
    'Written once and repeated for each item. Ask the agent to change it.',
  );
  assert.equal(
    refusal(
      `${KIT}export default ({ wide }) => <main>{wide ? <img src="/a.png" alt="" /> : null}</main>;`,
      'img',
    ),
    'This layer is written inside code (a list, a condition or a prop). Ask the agent to add to it.',
  );
  assert.equal(
    refusal(`${KIT}export default () => <main><p>Hello <b>you</b></p></main>;`, 'b'),
    'This layer sits inside text. Pick a layer that holds others.',
  );
  assert.equal(
    refusal(`${KIT}export default () => <main><svg><path d="M0 0" /></svg></main>;`, 'path'),
    'This layer is part of a vector. Pick a layer outside it.',
  );
});
