import { Spinner } from '@droidex/icons';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  loadBrowserSettings,
  setBrowserSettings,
  useBrowserSettings,
  type BrowserSettingsPatch,
  type BrowserSettingsSnapshot,
} from '../../lib/browserSettings';
import { toast } from '../../lib/toast';
import { SettingRow } from '../settingsKit';
import { Switch } from '../Switch';
import { BrowserCursorSettings } from './BrowserCursorSettings';
import { BrowserSavedLogins } from './BrowserSavedLogins';
import { BrowserSettingsGroup } from './BrowserSettingsPrimitives';
import { BrowserSiteGrants } from './BrowserSiteGrants';

/**
 * Settings > Browser: only the settings the browser enforces today. Each change
 * goes to main's store, which confirms in the prompt UI before it reduces
 * protection, so controls show the saved value once main answers, and no
 * other change starts until then.
 */
export function BrowserSettings() {
  const snapshot = useBrowserSettings();
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const api = window.droidControl;

  // Always fetched afresh: a site's remembered choice can change outside Settings.
  const load = useCallback(() => {
    if (!api) return;
    setLoadFailed(false);
    loadBrowserSettings().catch(() => {
      setLoadFailed(true);
    });
  }, [api]);

  useEffect(load, [load]);

  const commit = (change: () => Promise<BrowserSettingsSnapshot>, failure: string) => {
    if (isSaving) return;
    setIsSaving(true);
    change()
      .then(setBrowserSettings, () => {
        toast.error(failure);
        load();
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  if (!api) {
    return (
      <BrowserSettingsFrame>
        <p className="text-[12px] text-droid-text-muted">
          Browser settings are available in the DROIDEX desktop app.
        </p>
      </BrowserSettingsFrame>
    );
  }
  if (!snapshot && loadFailed) {
    return (
      <BrowserSettingsFrame>
        <div className="flex items-center gap-3 text-[12px] text-droid-text-secondary">
          Could not load browser settings.
          <button
            type="button"
            onClick={load}
            className="rounded-xl bg-droid-elevated/80 px-3 py-1.5 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated"
          >
            Retry
          </button>
        </div>
      </BrowserSettingsFrame>
    );
  }
  if (!snapshot) {
    return (
      <BrowserSettingsFrame>
        <div role="status" className="flex items-center gap-2 text-[12px] text-droid-text-muted">
          <Spinner className="h-3.5 w-3.5 motion-safe:animate-spin-slow" /> Loading browser
          settings…
        </div>
      </BrowserSettingsFrame>
    );
  }

  const save = (patch: BrowserSettingsPatch) => {
    commit(
      () => api.browserSettingsUpdate(patch),
      'Could not save that browser setting. Showing the saved settings.',
    );
  };

  return (
    <BrowserSettingsFrame>
      {/* Not disabled while saving: that would drop focus from the control the
          user just used, which the confirm dialog returns focus to. */}
      <div aria-busy={isSaving} className={isSaving ? 'pointer-events-none' : undefined}>
        <BrowserSettingsGroup>
          <SettingRow
            label="Agent browser access"
            description="Let agents control the shared built-in browser."
          >
            <Switch
              label="Agent browser access"
              checked={snapshot.agentAccessEnabled}
              onChange={(agentAccessEnabled) => {
                save({ agentAccessEnabled });
              }}
            />
          </SettingRow>
        </BrowserSettingsGroup>
        <BrowserSavedLogins loginFillApproval={snapshot.loginFillApproval} onPatch={save} />
        <BrowserSiteGrants
          snapshot={snapshot}
          onPatch={save}
          onRevoke={(origin, permission) => {
            commit(
              () => api.browserSitePermissionRevoke(origin, permission),
              'Could not remove that site choice. Showing the saved choices.',
            );
          }}
        />
        <BrowserCursorSettings snapshot={snapshot} onPatch={save} />
      </div>
    </BrowserSettingsFrame>
  );
}

function BrowserSettingsFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl pb-10">
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-droid-text">Browser</h1>
        <p className="mt-1.5 max-w-xl text-[12px] leading-5 text-droid-text-muted">
          Control what agents may do in the built-in browser.
        </p>
      </div>
      {children}
    </div>
  );
}
