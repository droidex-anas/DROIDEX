import { useEffect, useState } from 'react';
import {
  getHardwareAcceleration,
  isHardwareAccelerationSettingAvailable,
  setHardwareAcceleration,
} from '../lib/hardwareAcceleration';
import { relaunchApp } from '../lib/onboarding';
import { GroupLabel } from './settingsKit';
import { Switch } from './Switch';
import { Button } from './ui/Button';

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
      <div className="mb-8 rounded-xl bg-surface shadow-lg divide-y divide-divider">
        <div className="flex items-start justify-between gap-5 px-4 py-4">
          <div className="min-w-0">
            <div className="text-body text-primary">Hardware acceleration</div>
            <p className="mt-0.5 max-w-xl text-caption text-muted">
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
          <p className="text-caption text-muted">Changes take effect after you restart DROIDEX.</p>
          {needsRestart && (
            <Button size="sm" onClick={() => void relaunchApp()}>
              Restart now
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="px-4 py-3 text-body text-danger">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
