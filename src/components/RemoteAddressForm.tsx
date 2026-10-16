import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { HANDLE_PATTERN } from '../../packages/remote/src';
import type { RemoteSettings } from '../../packages/remote/src/desktop';
import { ghostButton, primaryButton } from './buttonStyles';

const field =
  'mt-1.5 block h-9 w-full rounded-lg bg-droid-elevated px-3 text-[13px] text-droid-text transition-colors placeholder:text-droid-text-muted focus:outline-none focus-visible:bg-droid-active disabled:opacity-50';

// Normal users only choose a name and username. Relay and web client
// addresses belong to self-hosters and stay behind the Advanced disclosure.
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
  const [advanced, setAdvanced] = useState(false);
  const usernameValid = HANDLE_PATTERN.test(username);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          profile: { displayName: name.trim(), username },
          relayUrl: relay.trim(),
          clientUrl: client.trim(),
        });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[12px] text-droid-text-secondary">
          Name
          <input
            autoFocus
            required
            className={field}
            value={name}
            maxLength={80}
            placeholder="Ada Lovelace"
            onChange={(event) => {
              setName(event.target.value);
            }}
            autoComplete="name"
          />
        </label>
        <label className="block text-[12px] text-droid-text-secondary">
          Username
          <span className="relative block">
            <span className="pointer-events-none absolute left-3 top-1/2 mt-[3px] -translate-y-1/2 text-[13px] text-droid-text-muted">
              @
            </span>
            <input
              required
              pattern={HANDLE_PATTERN.source.replace('-]', '\\-]')}
              minLength={3}
              maxLength={30}
              className={`${field} pl-7`}
              value={username}
              placeholder="ada"
              onChange={(event) => {
                setUsername(event.target.value.toLowerCase());
              }}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </span>
        </label>
      </div>
      <p className="text-[11px] leading-[18px] text-droid-text-muted">
        {username && !usernameValid
          ? 'Use 3–30 lowercase letters, numbers or hyphens, starting with a letter.'
          : 'Your username is public. It’s part of your Remote address and your profile page.'}
      </p>

      <div>
        <button
          type="button"
          aria-expanded={advanced}
          onClick={() => {
            setAdvanced(!advanced);
          }}
          className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-1 text-[12px] text-droid-text-muted transition-colors hover:text-droid-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/40"
        >
          <ChevronRight
            size={13}
            className={`transition-transform duration-200 ${advanced ? 'rotate-90' : ''}`}
          />
          Advanced
        </button>
        {advanced && (
          <div className="mt-2 space-y-3 rounded-xl bg-droid-elevated/50 p-4">
            <div>
              <p className="text-[12px] font-medium text-droid-text">Self-host Remote</p>
              <p className="mt-0.5 text-[11px] leading-[18px] text-droid-text-muted">
                Point DROIDEX at your own relay and web client. The Remote guide in the repository
                explains how to deploy both.
              </p>
            </div>
            <label className="block text-[12px] text-droid-text-secondary">
              Relay address
              <input
                className={`${field} bg-droid-surface`}
                value={relay}
                onChange={(event) => {
                  setRelay(event.target.value);
                }}
                placeholder="wss://your-relay.workers.dev"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
            <label className="block text-[12px] text-droid-text-secondary">
              Web client address
              <input
                className={`${field} bg-droid-surface`}
                value={client}
                onChange={(event) => {
                  setClient(event.target.value);
                }}
                placeholder="https://droidex.vercel.app"
                autoCapitalize="none"
                spellCheck={false}
              />
            </label>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        {cancel && (
          <button type="button" disabled={busy} onClick={cancel} className={ghostButton}>
            Cancel
          </button>
        )}
        <button
          type="submit"
          disabled={busy || !name.trim() || !usernameValid}
          className={primaryButton}
        >
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </div>
    </form>
  );
}
