import { useState, type SyntheticEvent } from 'react';
import { ArrowRight, Laptop, QrCode, ShieldCheck } from 'lucide-react';
import { HANDLE_PATTERN } from '../../packages/remote/src/index';
import { primaryButton } from '../../src/components/buttonStyles';
import { fieldClass, GateLayout, GateScreen } from './GateLayout';

const PAIRING_STEPS = [
  {
    icon: <Laptop size={15} aria-hidden />,
    text: 'On your laptop, open DROIDEX → Settings → Remote.',
  },
  {
    icon: <QrCode size={15} aria-hidden />,
    text: 'Scan its pairing code with this device, or open its pairing link here.',
  },
  {
    icon: <ShieldCheck size={15} aria-hidden />,
    text: 'Enter your authenticator code, then approve on the laptop.',
  },
];

/** Shown until this browser holds the pairing key of the laptop it should open. */
export function Welcome({ handle, error }: { handle: string; error: string }) {
  const [formError, setFormError] = useState('');
  const message = formError || error;
  return (
    <GateLayout handle={handle || undefined}>
      <GateScreen
        title={handle ? `Pair this browser with @${handle}` : 'DROIDEX, from any browser'}
      >
        <p>
          {handle
            ? 'This browser doesn’t have the pairing key for this laptop yet. Pairing takes about a minute.'
            : 'Drive DROIDEX on your laptop from here, with every project, chat and terminal. Your laptop does the work.'}
        </p>
        <ol className="space-y-3">
          {PAIRING_STEPS.map(({ icon, text }, index) => (
            <li key={text} className="flex items-start gap-3 text-[13px] leading-5">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-droid-elevated text-droid-text-secondary">
                {icon}
              </span>
              <span className="pt-1.5">
                <span className="sr-only">Step {index + 1}: </span>
                {text}
              </span>
            </li>
          ))}
        </ol>
        <form
          className="grid gap-2 pt-2"
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
          <label htmlFor="handle" className="text-[13px]">
            {handle ? 'Paired a different laptop?' : 'Already paired this browser?'}
          </label>
          <div className="flex gap-2">
            <span className="relative flex min-w-0 flex-1">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-droid-text-muted"
              >
                @
              </span>
              <input
                id="handle"
                name="handle"
                className={`${fieldClass} pl-8`}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                maxLength={30}
                aria-invalid={formError !== '' || undefined}
                onChange={() => {
                  if (formError) setFormError('');
                }}
              />
            </span>
            <button
              className={`${primaryButton} !h-11 !w-11 !rounded-xl !px-0`}
              aria-label="Open your laptop"
            >
              <ArrowRight size={17} />
            </button>
          </div>
          {message && (
            <p role="alert" className="text-[13px] leading-5 text-droid-red">
              {message}
            </p>
          )}
        </form>
      </GateScreen>
    </GateLayout>
  );
}
