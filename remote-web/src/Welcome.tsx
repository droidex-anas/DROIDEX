import { useState, type SyntheticEvent } from 'react';
import { ArrowRight, ShieldCheck } from '@droidex/icons';
import { HANDLE_PATTERN } from '../../packages/remote/src/index';
import { Button } from '../../src/components/ui/Button';
import { Field, Input } from '../../src/components/ui/Field';
import { GateLayout, GateScreen } from './GateLayout';

/** Shown until this browser holds the pairing key of the laptop it should open. */
export function Welcome({ handle, error }: { handle: string; error: string }) {
  const [formError, setFormError] = useState('');
  const message = formError || error;
  return (
    <GateLayout handle={handle || undefined} scene="handle" step={0}>
      <GateScreen
        title={handle ? `Pair this browser with @${handle}` : 'Your laptop, in any browser'}
        line={
          handle
            ? 'On your laptop, open Settings → Remote and scan its pairing code with this device, or open its pairing link here.'
            : 'Pair it once: on your laptop, open Settings → Remote and scan the code. Then drive every project, chat and terminal from here.'
        }
      >
        <form
          noValidate
          onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
            event.preventDefault();
            const input = new FormData(event.currentTarget).get('handle');
            if (typeof input !== 'string' || !HANDLE_PATTERN.test(input)) {
              setFormError(
                'Use 3–30 lowercase letters, numbers or hyphens, starting with a letter.',
              );
              return;
            }
            window.location.assign(`/${input}`);
          }}
        >
          <Field
            label={handle ? 'Paired a different laptop?' : 'Already paired this browser?'}
            error={message || undefined}
          >
            <div className="flex gap-2">
              <Input
                leading="@"
                name="handle"
                className="flex-1"
                placeholder="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={30}
                onChange={() => {
                  if (formError) setFormError('');
                }}
              />
              <Button
                type="submit"
                variant="primary"
                size="lg"
                icon={ArrowRight}
                aria-label="Open your laptop"
              />
            </div>
          </Field>
        </form>
        <div className="flex gap-3 rounded-lg bg-surface p-4">
          <ShieldCheck className="mt-0.5 size-icon-md shrink-0 text-secondary" aria-hidden="true" />
          <div className="flex flex-col gap-1">
            <p className="text-body-strong text-primary">Private by design</p>
            <p className="text-body text-secondary">
              Your laptop approves every device, and its pairing code proves this page is talking to
              your laptop.
            </p>
          </div>
        </div>
        <p className="text-caption text-muted">
          No account. No cloud agents. Keep DROIDEX open on your laptop.
        </p>
      </GateScreen>
    </GateLayout>
  );
}
