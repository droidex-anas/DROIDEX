import { Check } from '@droidex/icons';

export type SetupStepId = 'agents' | 'setup' | 'defaults';

const STEPS: { id: SetupStepId; label: string }[] = [
  { id: 'agents', label: 'Agents' },
  { id: 'setup', label: 'Set up' },
  { id: 'defaults', label: 'Defaults' },
];

type Place = 'done' | 'current' | 'upcoming';

function placeOf(index: number, current: number): Place {
  if (index < current) return 'done';
  return index === current ? 'current' : 'upcoming';
}

/** The three setup steps; a finished one takes you back to it. */
export function StepProgress({
  current,
  onGo,
}: {
  current: SetupStepId;
  onGo: (step: SetupStepId) => void;
}) {
  const currentIndex = STEPS.findIndex((step) => step.id === current);
  return (
    <ol className="ob-progress" aria-label="Setup steps">
      {STEPS.map((step, index) => {
        const place = placeOf(index, currentIndex);
        return (
          <li key={step.id}>
            <button
              type="button"
              className="ob-progress-step text-label"
              data-state={place}
              aria-current={place === 'current' ? 'step' : undefined}
              disabled={place !== 'done'}
              onClick={() => {
                onGo(step.id);
              }}
            >
              <span className="ob-progress-dot text-caption tabular-nums" aria-hidden="true">
                {place === 'done' ? (
                  <Check size={14} strokeWidth={2.75} className="ob-tick" />
                ) : (
                  index + 1
                )}
              </span>
              {step.label}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
