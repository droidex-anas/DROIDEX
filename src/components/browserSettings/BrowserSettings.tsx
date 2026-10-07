import { Spinner } from '@droidex/icons';
import { AlertTriangle, PanelTop } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  loadBrowserSettings,
  saveBrowserSettings,
  type BrowserLoginFillApproval,
  type BrowserNavigationApproval,
  type BrowserSettingsPatch,
  type BrowserSettingsSnapshot,
} from '../../lib/browserSettings';
import { isDesktop } from '../../lib/desktop';
import { toast } from '../../lib/toast';
import { Dropdown } from '../settingsKit';
import { Switch } from '../Switch';

const NAVIGATION_OPTIONS: { value: BrowserNavigationApproval; label: string }[] = [
  { value: 'follow_autonomy', label: 'Follow autonomy' },
  { value: 'always_ask', label: 'Always ask' },
  { value: 'new_sites', label: 'Ask for new sites' },
  { value: 'never_ask', label: 'Full site access' },
];
const LOGIN_OPTIONS: { value: BrowserLoginFillApproval; label: string }[] = [
  { value: 'always_ask', label: 'Always ask' },
  { value: 'never', label: 'Never use' },
];

/**
 * Settings > Browser. Every change goes to main's store, which asks for
 * confirmation in the browser prompt UI before it reduces protection, so a
 * control shows the saved value only once main answers.
 */
export function BrowserSettings() {
  const [snapshot, setSnapshot] = useState<BrowserSettingsSnapshot | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(() => {
    setLoadFailed(false);
    loadBrowserSettings().then(setSnapshot, () => {
      setLoadFailed(true);
    });
  }, []);

  useEffect(() => {
    if (isDesktop()) load();
  }, [load]);

  const save = (patch: BrowserSettingsPatch) => {
    setIsSaving(true);
    saveBrowserSettings(patch)
      .then(setSnapshot, () => {
        toast.error('Could not save that browser setting. Showing the saved settings.');
        load();
      })
      .finally(() => {
        setIsSaving(false);
      });
  };

  if (!isDesktop()) {
    return (
      <BrowserSettingsFrame>
        <p className="text-[12px] text-droid-text-muted">
          Browser settings are available in the DROIDEX desktop app.
        </p>
      </BrowserSettingsFrame>
    );
  }
  if (loadFailed) {
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

  return (
    <BrowserSettingsFrame>
      <Card>
        <div className="flex items-center justify-between gap-5 px-4 py-4">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-droid-elevated">
              <PanelTop className="h-5 w-5 text-droid-text-secondary" />
            </span>
            <div>
              <div className="text-[13px] font-medium text-droid-text">Agent browser access</div>
              <p className="mt-0.5 text-[12px] leading-snug text-droid-text-muted">
                Let agents control the shared built-in browser under the rules below.
              </p>
            </div>
          </div>
          <Switch
            label="Agent browser access"
            checked={snapshot.agentAccessEnabled}
            disabled={isSaving}
            onChange={(agentAccessEnabled) => {
              save({ agentAccessEnabled });
            }}
          />
        </div>
      </Card>

      <Group title="Agent safety">
        <Card>
          <Row
            label="Website opening approval"
            description="Follow task autonomy, ask by exact origin, or allow any safe HTTP(S) site."
          >
            <Dropdown
              value={snapshot.navigationApproval}
              options={NAVIGATION_OPTIONS}
              ariaLabel="Website opening approval"
              width="w-40"
              onChange={(value) => {
                const option = NAVIGATION_OPTIONS.find((candidate) => candidate.value === value);
                if (option) save({ navigationApproval: option.value });
              }}
            />
          </Row>
          <Row
            divided
            label="Agent login fill"
            description="Ask before an agent signs in with a saved login, or never let agents use them."
          >
            <Dropdown
              value={snapshot.loginFillApproval}
              options={LOGIN_OPTIONS}
              ariaLabel="Agent login fill"
              width="w-40"
              onChange={(value) => {
                const option = LOGIN_OPTIONS.find((candidate) => candidate.value === value);
                if (option) save({ loginFillApproval: option.value });
              }}
            />
          </Row>
          <Row
            divided
            label="Show DROIDEX agent cursor"
            description="Keep a separate pointer on the agent’s last action and glide it to each click, hover, and scroll."
          >
            <Switch
              label="Show DROIDEX agent cursor"
              checked={snapshot.showAgentCursor}
              disabled={isSaving}
              onChange={(showAgentCursor) => {
                save({ showAgentCursor });
              }}
            />
          </Row>
        </Card>
      </Group>

      <Group title="Downloads">
        <Card>
          <Row
            label="Ask where to save downloads"
            description={`Show a save dialog before a file leaves the built-in browser. Otherwise it goes to the ${snapshot.downloadDirectoryLabel.toLowerCase()}.`}
          >
            <Switch
              label="Ask where to save browser downloads"
              checked={snapshot.askDownloadLocation}
              disabled={isSaving}
              onChange={(askDownloadLocation) => {
                save({ askDownloadLocation });
              }}
            />
          </Row>
        </Card>
      </Group>

      <Group title="Developer controls">
        <Card>
          <div className="flex items-start justify-between gap-5 px-4 py-3.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-droid-orange">
                <AlertTriangle className="h-3.5 w-3.5" /> Elevated access
              </div>
              <div className="mt-1.5 text-[13px] tracking-tight text-droid-text">
                Agent diagnostics
              </div>
              <p className="mt-0.5 text-[12px] leading-snug text-droid-text-muted">
                Allow existing inspect, network, and console tools. This does not enable raw CDP
                access.
              </p>
            </div>
            <Switch
              label="Agent browser diagnostics"
              checked={snapshot.diagnosticsEnabled}
              disabled={isSaving || !snapshot.agentAccessEnabled}
              onChange={(diagnosticsEnabled) => {
                save({ diagnosticsEnabled });
              }}
            />
          </div>
        </Card>
      </Group>
    </BrowserSettingsFrame>
  );
}

function BrowserSettingsFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl pb-10">
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-droid-text">Browser</h1>
        <p className="mt-1.5 max-w-xl text-[12px] leading-5 text-droid-text-muted">
          Control the built-in browser and what agents may do in it.
        </p>
      </div>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="mb-2.5 text-[11px] font-medium uppercase tracking-wider text-droid-text-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-droid-border/80 bg-droid-surface">{children}</div>
  );
}

function Row({
  label,
  description,
  divided = false,
  children,
}: {
  label: string;
  description: string;
  divided?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-5 px-4 py-3.5 ${
        divided ? 'border-t border-droid-border/50' : ''
      }`}
    >
      <div className="min-w-0">
        <div className="text-[13px] tracking-tight text-droid-text">{label}</div>
        <div className="mt-0.5 text-[12px] leading-snug text-droid-text-muted">{description}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
