import type { ReactNode } from 'react';

export function StepHeader({ title, sub }: { title: string; sub: ReactNode }) {
  return (
    <header>
      <h1 className="droid-rise text-headline text-primary">{title}</h1>
      <p
        className="droid-rise mt-2.5 text-body-lg text-secondary"
        style={{ animationDelay: '50ms' }}
      >
        {sub}
      </p>
    </header>
  );
}
