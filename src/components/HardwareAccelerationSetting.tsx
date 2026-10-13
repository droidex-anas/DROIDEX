import { useEffect, useState } from 'react';
import {
  getHardwareAcceleration,
  isHardwareAccelerationSettingAvailable,
  setHardwareAcceleration,
} from '../lib/hardwareAcceleration';
import { relaunchApp } from '../lib/onboarding';
import { GroupLabel } from './settingsKit';
import { Switch } from './Switch';

export function HardwareAccelerationSetting() {
  if (!isHardwareAccelerationSettingAvailable()) return null;
  return <HardwareAccelerationSettingPanel />;
}

function HardwareAccelerationSettingPanel() {
  const [enabled, setEnabled] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [needsRestart, setNeedsRestart] = useState(false);

  useEffect(() => {
    let active = true;
    void getHardwareAcceleration()
      .then((preference) => {
        if (active) setEnabled(preference.enabled);
      })
      .catch(() => {
        if (active) setError('Could not load the hardware acceleration preference.');
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const update = async (nextEnabled: boolean) => {
    setIsLoading(true);
    setError('');
    try {
      const preference = await setHardwareAcceleration(nextEnabled);
      setEnabled(preference.enabled);
      setNeedsRestart(true);
    } catch {
      setError('Could not save the hardware acceleration preference. Try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <GroupLabel>Performance</GroupLabel>
      <div className="mb-8 rounded-lg border border-divider bg-surface divide-y divide-divider">
        <div className="flex items-start justify-between gap-5 px-4 py-4">
          <div className="min-w-0">
            <div className="text-[13px] text-primary">Hardware acceleration</div>
            <p className="mt-1 max-w-xl text-[11px] leading-[17px] text-muted">
              Uses your GPU for smoother rendering. Turn this off if DROIDEX is blank, flickers, or
              crashes because of graphics drivers.
            </p>
          </div>
          <Switch
            label="Hardware acceleration"
            checked={enabled}
            disabled={isLoading}
            onChange={(value) => void update(value)}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <p className="text-[11px] leading-[17px] text-muted">
            Changes take effect after you restart DROIDEX.
          </p>
          {needsRestart && (
            <button
              type="button"
              onClick={() => void relaunchApp()}
              className="px-2.5 h-7 rounded-sm bg-elevated border border-divider text-[12px] text-primary hover:border-divider-strong transition-colors"
            >
              Restart now
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="px-4 pb-4 text-[12px] text-red-400">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
