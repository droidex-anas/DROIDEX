import { useEffect, useState } from 'react';
import { getAutomaticDiagnostics, setAutomaticDiagnostics } from '../lib/rendererDiagnostics';
import { getUsageAnalyticsPreference, setUsageAnalyticsPreference } from '../lib/usageAnalytics';
import { Switch } from './Switch';

interface Preference {
  enabled: boolean;
  isLoading: boolean;
  error: string;
  update: (next: boolean) => void;
}

function usePreference(
  load: () => Promise<{ enabled: boolean }>,
  save: (enabled: boolean) => Promise<{ enabled: boolean }>,
  subject: string,
): Preference {
  const [enabled, setEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void load()
      .then((preference) => {
        if (active) setEnabled(preference.enabled);
      })
      .catch(() => {
        if (active) setError(`Could not load the ${subject} preference.`);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
    // The loader and saver are module functions, stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (next: boolean) => {
    setIsLoading(true);
    setError('');
    void save(next)
      .then((preference) => {
        setEnabled(preference.enabled);
      })
      .catch(() => {
        setError(`Could not save the ${subject} preference. Try again.`);
      })
      .finally(() => {
        setIsLoading(false);
      });
  };

  return { enabled, isLoading, error, update };
}

export function DiagnosticsSettings() {
  const diagnostics = usePreference(
    getAutomaticDiagnostics,
    setAutomaticDiagnostics,
    'diagnostics',
  );
  const analytics = usePreference(
    getUsageAnalyticsPreference,
    setUsageAnalyticsPreference,
    'usage analytics',
  );

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-7">
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-droid-text">
          Privacy & diagnostics
        </h1>
        <p className="mt-1.5 max-w-xl text-[12px] leading-5 text-droid-text-muted">
          Control the automatic operational data DROIDEX sends to its private Sentry project.
        </p>
      </div>

      <div className="mb-3 text-[11px] font-medium uppercase tracking-wider text-droid-text-muted">
        Automatic diagnostics
      </div>
      <div className="rounded-xl border border-droid-border bg-droid-surface">
        <div className="flex items-start justify-between gap-5 px-4 py-4">
          <div className="min-w-0">
            <div className="text-[13px] text-droid-text">Crash reports and Release Health</div>
            <p className="mt-1 max-w-xl text-[11px] leading-[17px] text-droid-text-muted">
              Sends app version, runtime and device context, crash stacks, native crash dumps, and a
              random local profile ID. Crash material can contain incidental sensitive data. It does
              not intentionally attach account identity as structured data. A minidump can still
              contain incidental account or credential data and is not used for feature analytics.
            </p>
          </div>
          <Switch
            label="Automatic crash reports and Release Health"
            checked={diagnostics.enabled}
            disabled={diagnostics.isLoading}
            onChange={(value) => {
              diagnostics.update(value);
            }}
          />
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-[17px] text-droid-text-muted">
        Changes apply immediately. Turning it off stops automatic reporting and deletes the local
        profile ID. Reports you explicitly submit through <span className="font-mono">/bug</span> or{' '}
        <span className="font-mono">/feedback</span> are still sent when you choose Submit.
      </p>
      {diagnostics.error && (
        <p role="alert" className="mt-3 text-[12px] text-red-400">
          {diagnostics.error}
        </p>
      )}

      <div className="mb-3 mt-8 text-[11px] font-medium uppercase tracking-wider text-droid-text-muted">
        Anonymous usage analytics
      </div>
      <div className="rounded-xl border border-droid-border bg-droid-surface">
        <div className="flex items-start justify-between gap-5 px-4 py-4">
          <div className="min-w-0">
            <div className="text-[13px] text-droid-text">Count this installation</div>
            <p className="mt-1 max-w-xl text-[11px] leading-[17px] text-droid-text-muted">
              Records that the app was opened, so DROIDEX knows how many installations are active.
              It sends a random installation ID, the app version, your platform and architecture,
              and which channel the build came from. It never sends your name, email, prompts,
              messages, file contents, repository names, or paths, and the ID is not derived from
              your device or account. The analytics service also records the IP address the
              connection comes from and the approximate location, city and country, it resolves to.
              Released builds only.
            </p>
          </div>
          <Switch
            label="Anonymous usage analytics"
            checked={analytics.enabled}
            disabled={analytics.isLoading}
            onChange={(value) => {
              analytics.update(value);
            }}
          />
        </div>
      </div>

      <p className="mt-3 text-[11px] leading-[17px] text-droid-text-muted">
        Turning it off stops the counting and deletes the stored installation ID. Turning it back on
        creates a new one, which counts as a separate installation.
      </p>
      {analytics.error && (
        <p role="alert" className="mt-3 text-[12px] text-red-400">
          {analytics.error}
        </p>
      )}
    </div>
  );
}
