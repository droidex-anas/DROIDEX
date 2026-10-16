import { useState } from 'react';
import { Check } from '@droidex/icons';

import type { OnboardingController } from '../../../hooks/useOnboarding';
import { BrandMark } from '../../BrandMark';
import { Button } from '../../ui/Button';

// Closing cover: the welcome cover mirrored, confirming what is ready before
// the wizard fades into the app itself.
export function DoneStep({
  controller,
  onComplete,
}: {
  controller: OnboardingController;
  onComplete: () => void;
}) {
  const { env } = controller;
  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const summary = [
    { label: 'Droid CLI', ok: Boolean(env?.cli.present) },
    {
      label: 'Signed in',
      ok: Boolean(env?.auth.loginPresent) || Boolean(env?.auth.apiKeyConfigured),
    },
  ];

  const finish = async () => {
    setFinishing(true);
    setFinishError(null);
    try {
      await controller.patch({ completed: true });
      onComplete();
    } catch {
      setFinishError("Couldn't finish setup. Try again.");
    } finally {
      setFinishing(false);
    }
  };

  return (
    <div className="flex flex-col items-center text-center">
      <div className="droid-rise">
        <BrandMark size={34} className="text-accent" />
      </div>
      <h1
        className="droid-rise mt-6 text-balance text-title text-primary"
        style={{ animationDelay: '90ms' }}
      >
        You&apos;re all set.
      </h1>
      <p
        className="droid-rise mt-3 max-w-xs text-body text-muted"
        style={{ animationDelay: '160ms' }}
      >
        The cockpit is yours. Open a session and give your agents something interesting to do.
      </p>
      <div
        className="droid-rise mt-8 w-full max-w-xs overflow-hidden rounded-lg bg-surface py-1"
        style={{ animationDelay: '230ms' }}
      >
        {summary.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-2">
            <span className="text-body text-secondary">{row.label}</span>
            {row.ok ? (
              <Check className="size-icon-md text-success" />
            ) : (
              <span className="text-caption text-muted">Pending</span>
            )}
          </div>
        ))}
      </div>
      <div className="droid-rise mt-8" style={{ animationDelay: '300ms' }}>
        <Button
          variant="primary"
          size="lg"
          loading={finishing}
          onClick={() => {
            void finish();
          }}
          disabled={finishing}
        >
          Start building
        </Button>
        {finishError && <p className="mt-3 text-body text-danger">{finishError}</p>}
      </div>
    </div>
  );
}
