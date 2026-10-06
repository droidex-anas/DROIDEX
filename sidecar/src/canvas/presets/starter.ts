export const HEY_TSX = `import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { Badge, Button, Card, Dialog, Input, Tabs } from '@droidex/design-system';

export default function Hey() {
  const [done, setDone] = useState(false);
  const [name, setName] = useState('');
  const [tab, setTab] = useState('start');
  const [open, setOpen] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center p-6 sm:p-10">
      <Card className="flex w-full max-w-lg flex-col gap-6">
        <Badge>{done ? 'Ready when you are' : 'Your next chapter'}</Badge>
        <div className="space-y-3">
          <h1>Hey, welcome in.</h1>
          <p className="text-[color:var(--ds-fg-muted)]">A small place to start something good.</p>
        </div>
        <Tabs
          label="Getting started"
          value={tab}
          onValueChange={setTab}
          items={[
            {
              value: 'start',
              label: 'Start here',
              content: (
                <div className="space-y-4">
                  <Input
                    label="Your name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="How should we call you?"
                    disabled={done}
                    hint="Just for this preview. Nothing is sent."
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => setDone(true)} disabled={done}>
                      {done ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <ArrowRight size={16} aria-hidden="true" />
                      )}
                      {done ? "You're all set" : 'Get started'}
                    </Button>
                    {done ? (
                      <Button variant="quiet" onClick={() => setDone(false)}>
                        Start over
                      </Button>
                    ) : null}
                  </div>
                  <p role="status">
                    {done ? 'Welcome' + (name.trim() ? ', ' + name.trim() : '') + '.' : ''}
                  </p>
                </div>
              ),
            },
            {
              value: 'details',
              label: 'Details',
              content: (
                <div className="space-y-4">
                  <p>This is your space to try an idea. Your changes stay in this preview.</p>
                  <Button variant="secondary" onClick={() => setOpen(true)}>
                    How it works
                  </Button>
                </div>
              ),
            },
            { value: 'later', label: 'Coming soon', disabled: true, content: null },
          ]}
        />
        <Dialog open={open} onClose={() => setOpen(false)} title="Make yourself at home">
          <p>Try your name, switch tabs, and get started. You can start over at any time.</p>
          <Button
            className="mt-4"
            onClick={() => {
              setOpen(false);
              setTab('start');
            }}
          >
            Try it
          </Button>
        </Dialog>
      </Card>
    </main>
  );
}
`;

export const UNIVERSAL_GUIDANCE = `Import primitives from @droidex/design-system. Button accepts native button props
and variant primary | secondary | quiet (default primary); Card accepts div props
and children; Badge accepts span props. Input accepts native input props plus a
required visible label and optional hint/error; it connects descriptions and errors.
Tabs takes label, value, onValueChange and items: { value, label, content, disabled? }[].
Use unique item values and keep value on an enabled item. Arrow keys, Home and End
move and select; Tab enters the active panel. Dialog takes open, onClose, title and
children; keep open in state, set false in onClose. Its native modal traps focus,
Escape requests close, and closing restores focus. Use buttons, not clickable divs.

Give every control a real action, labels, and honest loading/empty/error states.
Keep the focus, disabled and reduced-motion behavior. Use semantic --ds-* tokens;
foreground on raised/surface/canvas, muted for secondary text, accent-fg on accent,
and foreground on accent-soft. Use tone and shadow to separate layers, not nested
outlines. Reserve a primary action for the next useful step.

Use complete literal Tailwind 3 classes in every source file; never concatenate
class fragments. Import named icons from lucide-react, never a dynamic icon map.
Decorative icons use aria-hidden; icon-only buttons need an accessible name.
Use the compiler import allowlist: react, react/jsx-runtime, react-dom/client,
lucide-react and @droidex/design-system are available, as are relative source
modules. Unsupported package imports fail. No remote imports or fonts.
The kit includes licensed Latin fonts; other scripts use local system fonts.
Local component state resets on a source revision or refresh.
`;
