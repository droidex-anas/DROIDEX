import { Check, Spinner } from '@droidex/icons';
import type { ReactNode } from 'react';
import { cn } from '../ui/cn';

// Shared furniture for the first-run wizard. Controls come from ui/ and the
// settings kit, so the tour matches the active theme like every other screen.

/** Quiet section label, matching the settings group headers. */
export function StepLabel({ children }: { children: ReactNode }) {
  return <div className="mb-2 select-none text-label text-muted">{children}</div>;
}

export function StepTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-6">
      <h2 className="text-subheading text-primary">{title}</h2>
      {sub && <p className="mt-1 text-body text-secondary">{sub}</p>}
    </div>
  );
}

/** A surface one tone up from the canvas for grouped rows. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('overflow-hidden rounded-lg bg-surface', className)}>{children}</div>;
}

export function StatusDot({ status }: { status: 'pending' | 'ok' | 'missing' }) {
  return (
    <span className="flex size-5 shrink-0 items-center justify-center">
      {status === 'pending' && (
        <Spinner className="size-icon-sm text-muted motion-safe:animate-spin-slow" />
      )}
      {status === 'ok' && <Check className="size-icon-md text-success" />}
      {status === 'missing' && <span className="size-1.5 rounded-full bg-muted" />}
    </span>
  );
}
