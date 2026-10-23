import type { ReactNode } from 'react';
import { cn } from '../../components/ui/cn';

/**
 * Where a Remote setup stands, as one bar per step. `current` is the step in
 * progress; -1 previews the journey before it starts.
 */
export function JourneySteps({
  label,
  steps,
  current,
  className,
}: {
  label: string;
  steps: readonly string[];
  current: number;
  className?: string;
}) {
  return (
    <ol aria-label={label} className={cn('flex gap-2', className)}>
      {steps.map((step, index) => (
        <li
          key={step}
          aria-current={index === current ? 'step' : undefined}
          className="flex min-w-0 flex-1 flex-col gap-2"
        >
          <span
            aria-hidden="true"
            className={cn(
              'h-1 rounded-full transition-colors duration-300 ease-smooth-out',
              index <= current ? 'bg-text' : 'bg-elevated',
            )}
          />
          <span
            className={cn(
              'truncate text-caption transition-colors duration-300 ease-smooth-out',
              index === current ? 'text-primary' : 'text-muted',
            )}
          >
            {step}
            {index < current && <span className="sr-only"> (done)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * One moment of the journey: a headline, one line of why, then the single
 * thing to do. Key it by step so a new step rises in.
 */
export function JourneyStep({
  level,
  title,
  line,
  children,
}: {
  level: 1 | 2;
  title: string;
  line: ReactNode;
  children?: ReactNode;
}) {
  const Heading = level === 1 ? 'h1' : 'h2';
  return (
    <section className="droid-rise flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Heading className="text-balance text-title text-primary">{title}</Heading>
        <p className="text-pretty text-body-lg text-secondary">{line}</p>
      </div>
      {children}
    </section>
  );
}
