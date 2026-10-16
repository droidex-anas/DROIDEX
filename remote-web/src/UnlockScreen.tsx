import { useState, type SyntheticEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { primaryButton } from '../../src/components/buttonStyles';
import { CodeField } from './CodeField';
import { GateScreen, JourneySteps, largeButton } from './GateLayout';
import type { ConnectionStatus, RemoteConnection } from './remoteConnection';

/** Asks for a fresh authenticator code before this browser may request the laptop's approval. */
export function UnlockScreen({
  connection,
  status,
}: {
  connection: RemoteConnection;
  status: Extract<ConnectionStatus, { kind: 'code' }>;
}) {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(status.feedback);
  // A rejected code comes back as a new code status, not as a failed authenticate().
  const [attempt, setAttempt] = useState(status);
  if (attempt !== status) {
    setAttempt(status);
    setSubmitting(false);
    setCode('');
    setError(status.feedback);
  }

  const unlock = (value: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    connection.authenticate(value).catch((reason: unknown) => {
      setSubmitting(false);
      setCode('');
      setError(reason instanceof Error ? reason.message : 'Unable to unlock. Try again.');
    });
  };

  return (
    <GateScreen
      progress={<JourneySteps current="Unlock" />}
      icon={<KeyRound size={24} strokeWidth={1.5} />}
      title="Unlock this browser"
    >
      <p>Open your authenticator app and enter the current 6-digit code for DROIDEX.</p>
      <form
        className="grid gap-3"
        onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
          event.preventDefault();
          if (code.length === 6) unlock(code);
        }}
      >
        <CodeField
          value={code}
          onChange={(value) => {
            setCode(value);
            if (error) setError('');
          }}
          onComplete={unlock}
          busy={submitting}
          invalid={error !== ''}
        />
        {error && (
          <p role="alert" className="text-[13px] leading-5 text-droid-red">
            {error}
          </p>
        )}
        <button
          className={`${primaryButton} ${largeButton} mt-1`}
          disabled={submitting || code.length !== 6}
        >
          {submitting ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
      <p className="text-[12px] leading-5 text-droid-text-muted">
        Next, your laptop asks you to approve this browser.
      </p>
    </GateScreen>
  );
}
