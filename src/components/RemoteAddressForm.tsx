import { useState } from 'react';
import { HANDLE_PATTERN } from '../../packages/remote/src';
import type { RemoteSettings } from '../../packages/remote/src/desktop';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { Field, Input } from './ui/Field';
import { RowCaret } from './ui/Row';

// Normal users only choose a name and username. Relay and web client
// addresses belong to self-hosters and stay behind the disclosure.
export function RemoteAddressForm({
  settings,
  busy,
  save,
  cancel,
}: {
  settings: RemoteSettings;
  busy: boolean;
  save: (patch: Partial<RemoteSettings>) => Promise<void>;
  cancel?: () => void;
}) {
  const [name, setName] = useState(settings.profile.displayName);
  const [username, setUsername] = useState(settings.profile.username);
  const [relay, setRelay] = useState(settings.relayUrl);
  const [client, setClient] = useState(settings.clientUrl);
  const [selfHosting, setSelfHosting] = useState(false);
  const usernameValid = HANDLE_PATTERN.test(username);
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          profile: { displayName: name.trim(), username },
          relayUrl: relay.trim(),
          clientUrl: client.trim(),
        });
      }}
    >
      <Field label="Name">
        <Input
          autoFocus
          required
          value={name}
          maxLength={80}
          placeholder="Ada Lovelace"
          autoComplete="name"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </Field>
      <Field
        label="Username"
        hint="Public: it’s your Remote address and your profile page."
        error={
          username && !usernameValid
            ? 'Use 3–30 lowercase letters, numbers or hyphens, starting with a letter.'
            : undefined
        }
      >
        <Input
          leading="@"
          required
          pattern={HANDLE_PATTERN.source.replace('-]', '\\-]')}
          minLength={3}
          maxLength={30}
          value={username}
          placeholder="ada"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setUsername(event.target.value.toLowerCase());
          }}
        />
      </Field>

      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2.5"
          aria-expanded={selfHosting}
          aria-controls="remote-self-host"
          onClick={() => {
            setSelfHosting(!selfHosting);
          }}
        >
          <span className="flex items-center gap-1">
            Self-host Remote
            <RowCaret open={selfHosting} />
          </span>
        </Button>
        <div id="remote-self-host" className="expand-rows" data-open={selfHosting || undefined}>
          <div
            inert={!selfHosting}
            className={cn(
              'min-h-0 overflow-hidden transition-opacity duration-150 ease-out',
              !selfHosting && 'opacity-0',
            )}
          >
            <div className="flex flex-col gap-4 pt-3">
              <p className="text-caption text-muted">
                Point DROIDEX at your own relay and web client. The Remote guide in the repository
                explains how to deploy both.
              </p>
              <Field label="Relay address">
                <Input
                  value={relay}
                  placeholder="wss://your-relay.workers.dev"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(event) => {
                    setRelay(event.target.value);
                  }}
                />
              </Field>
              <Field label="Web client address">
                <Input
                  value={client}
                  placeholder="https://droidex.vercel.app"
                  autoCapitalize="none"
                  spellCheck={false}
                  onChange={(event) => {
                    setClient(event.target.value);
                  }}
                />
              </Field>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {cancel && (
          <Button variant="ghost" size="lg" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          loading={busy}
          disabled={busy || !name.trim() || !usernameValid}
        >
          {usernameValid ? `Claim @${username}` : 'Claim username'}
        </Button>
      </div>
    </form>
  );
}
