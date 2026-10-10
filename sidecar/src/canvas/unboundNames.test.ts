import assert from 'node:assert/strict';
import test from 'node:test';
import { unboundNameDiagnostics } from './unboundNames.js';

test('a component or hook that is never imported is reported at its line', () => {
  const diagnostics = unboundNameDiagnostics({
    'main.tsx': `import { Card } from './Card';
import type { Badge } from './Badge';

export default function Pricing() {
  const [open, setOpen] = useState(false);
  const ref = React.useRef(null);
  return <Card><Check /><Check /><Icons.Star /><Badge /></Card>;
}
`,
  });
  assert.deepEqual(
    diagnostics.map(({ message, file, line }) => [message.split(' ')[0], file, line]),
    [
      ['useState', 'main.tsx', 5],
      ['React', 'main.tsx', 6],
      ['Check', 'main.tsx', 7],
      ['Icons', 'main.tsx', 7],
      ['Badge', 'main.tsx', 7],
    ],
  );
});

test('names bound anywhere in the file are never reported', () => {
  const files = {
    'main.tsx': `import * as Kit from '@droidex/design-system';
import Logo, { useTheme as useKitTheme } from './parts';

import React from 'react';
function useCount() { return 1; }
class Panel {}
const { Root: Dialog } = Kit;
namespace Parts { export const Row = () => null; }
import Field = Kit.Input;

export default function Page({ icon: Icon, items }: { icon: () => null; items: string[] }) {
  useCount();
  useKitTheme();
  return (
    <Dialog>
      <Logo /><Icon /><Kit.Button /><Parts.Row /><Field /><React.Fragment /><div /><svg><path /></svg>
      {items.map((Item) => <Item key={Item} />)}
    </Dialog>
  );
}
`,
  };
  assert.deepEqual(unboundNameDiagnostics(files), []);
});
