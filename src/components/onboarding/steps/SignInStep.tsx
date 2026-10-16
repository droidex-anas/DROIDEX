import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, KeyRound } from '@droidex/icons';

import type { OnboardingController } from '../../../hooks/useOnboarding';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Field';
import { Panel, StepLabel, StepTitle } from '../kit';

export function SignInStep({
  controller,
  onNext,
  onBack,
}: {
  controller: OnboardingController;
  onNext: () => void;
  onBack: () => void;
}) {
  const { env } = controller;
  const [showKey, setShowKey] = useState(false);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);
  const checkButtonRef = useRef<HTMLButtonElement>(null);
  const continueButtonRef = useRef<HTMLButtonElement>(null);
  const focusContinueAfterCheck = useRef(false);

  const signedIn = Boolean(env?.auth.loginPresent) || Boolean(env?.auth.apiKeyConfigured);

  useEffect(() => {
    if (signedIn && focusContinueAfterCheck.current) {
      continueButtonRef.current?.focus();
      focusContinueAfterCheck.current = false;
    }
  }, [signedIn]);

  const saveKey = async () => {
    setSaving(true);
    setKeyError(null);
    try {
      await controller.saveApiKey(key);
    } catch {
      setKeyError(
        "Couldn't save the API key. Check that secure storage is available and try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg">
      <StepLabel>Factory account</StepLabel>
      <StepTitle
        title="Bring your account."
        sub="DROIDEX uses the account already configured in the Droid CLI."
      />

      {signedIn ? (
        <Panel className="mb-6 flex items-center gap-2.5 px-4 py-3 text-body text-primary">
          <Check className="size-icon-md text-success" /> You&apos;re signed in.
        </Panel>
      ) : (
        <div className="mb-6 space-y-2">
          <Button
            ref={checkButtonRef}
            variant="primary"
            size="lg"
            icon={Check}
            onClick={() => {
              focusContinueAfterCheck.current = document.activeElement === checkButtonRef.current;
              controller.refreshEnv();
            }}
            disabled={!env?.cli.present}
            className="w-full"
          >
            Check CLI sign-in
          </Button>
          {!env?.cli.present && (
            <p className="text-center text-caption text-muted">Install the Droid CLI first.</p>
          )}
          {env?.cli.present && (
            <p className="text-center text-caption text-muted">
              Sign in with the Droid CLI in Terminal, then check the status here.
            </p>
          )}
          {!showKey ? (
            <Button
              variant="ghost"
              icon={KeyRound}
              onClick={() => {
                setShowKey(true);
              }}
              className="w-full"
            >
              Use an API key instead
            </Button>
          ) : (
            <Panel className="space-y-2 p-3">
              <Input
                type="password"
                aria-label="Factory API key"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                }}
                placeholder="FACTORY_API_KEY"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                className="font-mono"
              />
              <Button
                variant="primary"
                size="lg"
                loading={saving}
                onClick={() => {
                  void saveKey();
                }}
                disabled={!key.trim() || saving}
                className="w-full"
              >
                Save key
              </Button>
              {keyError && <p className="text-body text-danger">{keyError}</p>}
            </Panel>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button variant="ghost" size="lg" icon={ArrowLeft} onClick={onBack}>
          Back
        </Button>
        {signedIn ? (
          <Button
            ref={continueButtonRef}
            variant="primary"
            size="lg"
            onClick={onNext}
            className="flex-1"
          >
            Continue
          </Button>
        ) : (
          <Button size="lg" onClick={onNext} className="flex-1">
            Skip for now
          </Button>
        )}
      </div>
    </div>
  );
}
