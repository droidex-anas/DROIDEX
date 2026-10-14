import { useState } from 'react';
import { HANDLE_PATTERN } from '../../packages/remote/src';
import type { RemoteSettings } from '../../packages/remote/src/desktop';

const field =
  'mt-1.5 block min-h-11 w-full rounded-xl bg-droid-elevated px-3 text-[13px] text-droid-text placeholder:text-droid-text-muted focus:outline-none focus-visible:bg-droid-active disabled:opacity-50';

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
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save({
          profile: { displayName: name.trim(), username },
          relayUrl: relay.trim(),
          clientUrl: client.trim(),
        });
      }}
    >
      <label className="block text-[12px] text-droid-text-secondary">
        Your name
        <input
          autoFocus
          required
          className={field}
          value={name}
          maxLength={80}
          onChange={(event) => {
            setName(event.target.value);
          }}
          autoComplete="name"
        />
      </label>
      <label className="block text-[12px] text-droid-text-secondary">
        Username
        <input
          required
          pattern={HANDLE_PATTERN.source.replace('-]', '\\-]')}
          minLength={3}
          maxLength={30}
          className={field}
          value={username}
          onChange={(event) => {
            setUsername(event.target.value.toLowerCase());
          }}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
        <span className="mt-1.5 block text-[11px] leading-5 text-droid-text-muted">
          3–30 lowercase letters, numbers or hyphens, starting with a letter. Your username is a
          public address.
        </span>
      </label>
      <p className="truncate text-[12px] text-droid-text-muted">
        {client.replace(/\/$/, '')}/{username || 'yourname'}
      </p>
      <details open={!settings.relayUrl} className="text-[12px] text-droid-text-secondary">
        <summary className="cursor-pointer py-2">Hosting</summary>
        <div className="mt-2 space-y-4">
          <label className="block">
            Relay address
            <input
              required
              className={field}
              value={relay}
              onChange={(event) => {
                setRelay(event.target.value);
              }}
              placeholder="wss://your-relay.workers.dev"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <label className="block">
            Web client address
            <input
              required
              className={field}
              value={client}
              onChange={(event) => {
                setClient(event.target.value);
              }}
              placeholder="https://droidex.vercel.app"
              autoCapitalize="none"
              spellCheck={false}
            />
          </label>
          <p className="text-[11px] leading-5 text-droid-text-muted">
            Use your deployed relay, or host both pieces yourself. The repository’s Remote guide has
            setup instructions.
          </p>
        </div>
      </details>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={
            busy ||
            !name.trim() ||
            !HANDLE_PATTERN.test(username) ||
            !relay.trim() ||
            !client.trim()
          }
          className="min-h-11 rounded-xl bg-droid-active px-4 text-[13px] font-medium text-droid-text disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Save address'}
        </button>
        {cancel && (
          <button
            type="button"
            disabled={busy}
            onClick={cancel}
            className="min-h-11 rounded-xl px-4 text-[13px] text-droid-text-secondary hover:bg-droid-elevated"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
