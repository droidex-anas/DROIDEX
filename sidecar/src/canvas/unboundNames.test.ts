import assert from 'node:assert/strict';
import test from 'node:test';
import { unboundNameDiagnostics } from './unboundNames.js';

test('a component or hook that is never imported is reported at its line', () => {
  const diagnostics = unboundNameDiagnostics({
    'main.tsx': `import { Card } from './Card';

export default function Pricing() {
  const [open, setOpen] = useState(false);
  return <Card><Check /><Check /><Icons.Star /></Card>;
}
`,
  });
  assert.deepEqual(
    diagnostics.map(({ message, file, line }) => [message.split(' ')[0], file, line]),
    [
      ['useState', 'main.tsx', 4],
      ['Check', 'main.tsx', 5],
      ['Icons', 'main.tsx', 5],
    ],
  );
});

test('names bound anywhere in the file are never reported', () => {
  const files = {
    'main.tsx': `import * as Kit from '@droidex/design-system';
import Logo, { useTheme as useKitTheme } from './parts';

function useCount() { return 1; }
class Panel {}
const { Root: Dialog } = Kit;

export default function Page({ icon: Icon, items }: { icon: () => null; items: string[] }) {
  useCount();
  useKitTheme();
  return (
    <Dialog>
      <Logo /><Icon /><Kit.Button /><div /><svg><path /></svg>
      {items.map((Item) => <Item key={Item} />)}
    </Dialog>
  );
}
`,
  };
  assert.deepEqual(unboundNameDiagnostics(files), []);
});
