import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { SourceElementError } from './sourceElementError.js';
import { importEdits, type ModuleNames } from './sourceImports.js';
import { splice } from './sourceLines.js';

const KIT = '@droidex/design-system';

/** The file with `wanted` imported. */
function imported(text: string, wanted: ModuleNames[]): string {
  const source = ts.createSourceFile(
    'main.tsx',
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  return splice(text, importEdits(source, wanted, '\n'));
}

function refusal(text: string, wanted: ModuleNames[]): string {
  try {
    imported(text, wanted);
  } catch (error) {
    assert.ok(error instanceof SourceElementError);
    return error.message;
  }
  assert.fail('the import was not refused');
}

test('missing kit names join its named import, inline or a line each, and names it has stay', () => {
  assert.equal(
    imported(`import { Card } from '${KIT}';\n`, [
      { module: KIT, names: ['Button', 'Card', 'Button'] },
    ]),
    `import { Card, Button } from '${KIT}';\n`,
  );
  assert.equal(
    imported(`import {\n  Card,\n} from '${KIT}';\n`, [{ module: KIT, names: ['Badge'] }]),
    `import {\n  Card,\n  Badge,\n} from '${KIT}';\n`,
  );
  assert.equal(
    imported(`import {} from '${KIT}';\n`, [{ module: KIT, names: ['Badge'] }]),
    `import { Badge } from '${KIT}';\n`,
  );
});

test('a module the file does not import yet gets a new import after its last, written as that one is', () => {
  const text =
    'import { useState } from "react"\nimport { Card } from "./Card"\n\nexport default () => null\n';
  assert.equal(
    imported(text, [
      { module: KIT, names: ['Button'] },
      { module: 'lucide-react', names: ['Plus'] },
    ]),
    'import { useState } from "react"\nimport { Card } from "./Card"\nimport { Button } from "@droidex/design-system"\nimport { Plus } from "lucide-react"\n\nexport default () => null\n',
  );
});

test('a name the file binds otherwise, or a kit read as a namespace, is refused', () => {
  assert.equal(
    refusal(`function Button() { return null; }\n`, [{ module: KIT, names: ['Button'] }]),
    'This file already has its own Button. Ask the agent to add it.',
  );
  assert.equal(
    refusal(`import { Button } from './Button';\n`, [{ module: KIT, names: ['Button'] }]),
    'This file already has its own Button. Ask the agent to add it.',
  );
  assert.equal(
    refusal(`import type { Button } from '${KIT}';\n`, [{ module: KIT, names: ['Button'] }]),
    'This file already has its own Button. Ask the agent to add it.',
  );
  assert.equal(
    refusal(`import * as Kit from '${KIT}';\n`, [{ module: KIT, names: ['Button'] }]),
    'This file reads the kit another way. Ask the agent to add it.',
  );
});
