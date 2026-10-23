import { useState, type SyntheticEvent } from 'react';
import { Button } from '../../src/components/ui/Button';
import { CodeField } from './CodeField';
import { GateScreen } from './GateLayout';
import type { ConnectionStatus } from './remoteConnection';

/** Asks for a fresh authenticator code before this browser may request the laptop's approval. */
export function UnlockScreen({
  status,
  expired,
  authenticate,
}: {
  status: Extract<ConnectionStatus, { kind: 'code' }>;
  /** This browser was trusted before and its trust ran out. */
  expired: boolean;
  authenticate: (code: string) => Promise<void>;
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
    authenticate(value).catch((reason: unknown) => {
      setSubmitting(false);
      setCode('');
      setError(reason instanceof Error ? reason.message : 'Unable to unlock. Try again.');
    });
  };

  return (
    <GateScreen
      title={expired ? 'Welcome back' : 'Unlock this browser'}
      line={
        expired
          ? 'This browser’s trust ran out. Enter the current code from your authenticator to ask your laptop again.'
          : 'Enter the current 6-digit code from your authenticator app.'
      }
    >
      <form
        className="flex flex-col gap-3"
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
          <p role="alert" className="text-body text-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="mt-1 w-full"
          loading={submitting}
          disabled={submitting || code.length !== 6}
        >
          Unlock
        </Button>
        <p className="text-caption text-muted">Next, approve this browser on your laptop.</p>
      </form>
    </GateScreen>
  );
}
