import { Spinner } from '@droidex/icons';
import { AnimatePresence } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import type {
  BrowserCredentialsSnapshot,
  BrowserLoginFillApproval,
  BrowserSettingsPatch,
} from '../../lib/browserSettings';
import { toast } from '../../lib/toast';
import { Dropdown, SettingRow } from '../settingsKit';
import { BrowserConfirmDialog } from './BrowserConfirmDialog';
import { BrowserSettingsGroup, EmptyLine, SiteOrigin } from './BrowserSettingsPrimitives';

const LOGIN_OPTIONS: { value: BrowserLoginFillApproval; label: string }[] = [
  { value: 'always_ask', label: 'Always ask' },
  { value: 'never', label: 'Never use' },
];

function storageDescription(credentials: BrowserCredentialsSnapshot): string {
  if (!credentials.keychainAvailable) {
    return 'Encrypted storage is unavailable on this system, so logins cannot be saved.';
  }
  if (credentials.touchIdAvailable) {
    return 'Encrypted with your system keychain. Touch ID confirms each agent sign-in.';
  }
  return 'Encrypted with your system keychain.';
}

/**
 * The saved-login policy and the sites with a saved login. Main lists only
 * origins; a password never reaches the renderer.
 */
export function BrowserSavedLogins({
  loginFillApproval,
  onPatch,
}: {
  loginFillApproval: BrowserLoginFillApproval;
  onPatch: (patch: BrowserSettingsPatch) => void;
}) {
  const [credentials, setCredentials] = useState<BrowserCredentialsSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const api = window.droidControl;

  const load = useCallback(() => {
    if (!api) return;
    setLoadFailed(false);
    api.browserCredentialsList().then(setCredentials, () => {
      setLoadFailed(true);
    });
  }, [api]);

  useEffect(load, [load]);

  const deleteLogin = (origin: string) => {
    if (!api) return;
    setIsDeleting(true);
    api
      .browserCredentialsDelete(origin)
      .then(
        (next) => {
          setCredentials(next);
          setDeleting(null);
        },
        () => {
          toast.error('Could not delete that saved login. Showing the saved logins.');
          setDeleting(null);
          load();
        },
      )
      .finally(() => {
        setIsDeleting(false);
      });
  };

  return (
    <BrowserSettingsGroup title="Saved logins">
      <SettingRow
        label="Agent login fill"
        description="Ask before saving a login and before each agent sign-in with one. Never use turns saving and filling off."
      >
        <Dropdown
          value={loginFillApproval}
          options={LOGIN_OPTIONS}
          ariaLabel="Agent login fill"
          width="w-36"
          onChange={(value) => {
            const option = LOGIN_OPTIONS.find((candidate) => candidate.value === value);
            if (option) onPatch({ loginFillApproval: option.value });
          }}
        />
      </SettingRow>
      <SavedLoginList
        credentials={credentials}
        loadFailed={loadFailed}
        onRetry={load}
        onDelete={setDeleting}
      />
      <AnimatePresence>
        {deleting && (
          <BrowserConfirmDialog
            title="Delete saved login?"
            description={`DROIDEX will remove the encrypted login saved for ${deleting}.`}
            actionLabel="Delete login"
            busy={isDeleting}
            onCancel={() => {
              setDeleting(null);
            }}
            onConfirm={() => {
              deleteLogin(deleting);
            }}
          />
        )}
      </AnimatePresence>
    </BrowserSettingsGroup>
  );
}

function SavedLoginList({
  credentials,
  loadFailed,
  onRetry,
  onDelete,
}: {
  credentials: BrowserCredentialsSnapshot | null;
  loadFailed: boolean;
  onRetry: () => void;
  onDelete: (origin: string) => void;
}) {
  if (loadFailed) {
    return (
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-[11.5px] text-droid-text-muted">
        Could not load saved logins.
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-droid-elevated px-2.5 py-1 text-[11.5px] font-medium text-droid-text transition-colors hover:bg-droid-active"
        >
          Retry
        </button>
      </div>
    );
  }
  if (!credentials) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 px-4 py-3.5 text-[11.5px] text-droid-text-muted"
      >
        <Spinner className="h-3 w-3 motion-safe:animate-spin-slow" /> Loading saved logins…
      </div>
    );
  }
  return (
    <div>
      <p className="px-4 pt-3.5 text-[11px] leading-4 text-droid-text-muted">
        {storageDescription(credentials)}
      </p>
      {credentials.origins.length === 0 ? (
        <EmptyLine>No saved logins yet.</EmptyLine>
      ) : (
        <ul aria-label="Saved login sites" className="px-2 pb-2 pt-1.5">
          {credentials.origins.map((origin) => (
            <li
              key={origin}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-droid-elevated/50"
            >
              <SiteOrigin origin={origin} />
              <button
                type="button"
                onClick={() => {
                  onDelete(origin);
                }}
                aria-label={`Delete saved login for ${origin}`}
                className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-droid-text-muted transition-colors hover:bg-droid-red/10 hover:text-droid-red focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-red/50"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
