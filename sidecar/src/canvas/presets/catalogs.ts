// The catalogs the presets ship (kitCatalog.ts): an entry for each primitive
// that shows without state. An entry carries no state or handlers, so the
// controlled primitives (Tabs, Dialog, Switch, Menu) are left to the agent.

import { catalogFile } from '../kitCatalog.js';

const MODULE = 'index.tsx';

function entry(name: string, uses: string[], jsx: string, note: string | null = null) {
  return { name, module: MODULE, uses, icons: [], jsx, note };
}

/** The shared primitives' catalog, which Auto and every new kit that is not a copy carry. */
export const PRIMITIVE_CATALOG = catalogFile([
  entry('Button', ['Button'], '<Button>Continue</Button>', 'One primary action per view.'),
  entry('Secondary button', ['Button'], '<Button variant="secondary">Save draft</Button>'),
  entry('Quiet button', ['Button'], '<Button variant="quiet">Cancel</Button>'),
  entry(
    'Input',
    ['Input'],
    '<Input label="Email" type="email" placeholder="you@example.com" hint="We only use it to sign you in." />',
  ),
  entry(
    'Card',
    ['Card', 'Button'],
    `<Card className="flex max-w-md flex-col gap-4">
  <div className="space-y-2">
    <h2>Weekly summary</h2>
    <p className="text-[color:var(--ds-fg-muted)]">Twelve designs changed this week.</p>
  </div>
  <div className="flex gap-3">
    <Button>Review now</Button>
    <Button variant="quiet">Later</Button>
  </div>
</Card>`,
  ),
  entry('Badge', ['Badge'], '<Badge>In review</Badge>'),
]);

/** The DROIDEX preset's catalog: its controls and the app's chat, sidebar and window parts. */
export const DROIDEX_CATALOG = catalogFile([
  entry('Button', ['Button'], '<Button variant="primary" icon="plus">New chat</Button>'),
  entry('Secondary button', ['Button'], '<Button>Open folder</Button>'),
  entry(
    'Icon button',
    ['Button'],
    '<Button variant="ghost" icon="settings" aria-label="Settings" />',
    'Icon-only buttons need aria-label.',
  ),
  entry('Badge', ['Badge'], '<Badge tone="success" icon="circle-check">Merged</Badge>'),
  entry(
    'Card',
    ['Card'],
    `<Card className="flex max-w-sm flex-col gap-2 p-4">
  <h3 className="ds-heading">Release notes</h3>
  <p className="text-[color:var(--ds-fg-muted)]">Three fixes and a faster startup.</p>
</Card>`,
  ),
  entry(
    'Search field',
    ['Input'],
    '<Input label="Search chats" icon="search" placeholder="Search" hideLabel compact />',
  ),
  entry('Row', ['Row'], '<Row icon="git-branch" label="main" meta="2m" />', 'A readout row.'),
  entry('Section header', ['SectionHeader'], '<SectionHeader label="Recent" trailing="3" />'),
  entry('Keyboard key', ['Kbd'], '<Kbd>⌘K</Kbd>'),
  entry(
    'Toast',
    ['Toast'],
    '<Toast tone="success" title="Pushed to remote" description="Three commits on main." />',
  ),
  entry('Status glyph', ['StatusGlyph'], '<StatusGlyph status="working" />'),
  entry('Tool line', ['ToolLine'], '<ToolLine verb="Read" target="src/App.tsx" />'),
  entry('Command card', ['CommandCard'], '<CommandCard command="npm test" output="12 passing" />'),
  entry(
    'Diff card',
    ['DiffCard'],
    `<DiffCard
  path="src/App.tsx"
  added={2}
  removed={1}
  ops={[
    { type: 'del', text: 'const sticky = false;' },
    { type: 'add', text: 'const sticky = true;' },
    { type: 'add', text: 'const offset = 0;' },
  ]}
/>`,
  ),
  entry('Thinking line', ['ThinkingLine'], '<ThinkingLine duration="8s" />'),
  entry('Working indicator', ['WorkingIndicator'], '<WorkingIndicator elapsed="12s" />'),
  entry('User message', ['UserBubble'], '<UserBubble>Make the header sticky.</UserBubble>'),
  entry(
    'Assistant reply',
    ['AssistantText'],
    '<AssistantText>The header now stays at the top while the list scrolls.</AssistantText>',
  ),
  entry('Composer', ['Composer'], '<Composer />'),
  entry(
    'Session row',
    ['SessionRow'],
    '<SessionRow title="Fix the login redirect" time="2m" status="reply" provider="anthropic" />',
  ),
  entry('Sidebar heading', ['SidebarHeading'], '<SidebarHeading label="Today" count={4} />'),
  entry('Workspace row', ['WorkspaceRow'], '<WorkspaceRow name="droidex" />'),
  entry('Header tab', ['HeaderTab'], '<HeaderTab label="Design canvas" active />'),
  entry('Window controls', ['WindowControls'], '<WindowControls />'),
]);
