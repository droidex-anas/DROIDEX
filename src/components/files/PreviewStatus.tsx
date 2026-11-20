import type { ReactNode } from 'react';
import { AlertTriangle, Spinner } from '@droidex/icons';

// Most previews arrive within a frame or two; a loading indicator waits before
// it fades in, so a quick open goes straight from one file to the next.
const LOADING_REVEAL_DELAY = { animationDelay: '200ms', animationFillMode: 'both' } as const;

export function PreviewLoading({ label }: { label: string }) {
  return (
    <div
      className="flex h-full items-center justify-center gap-2 text-body text-muted motion-safe:animate-fade-in"
      style={LOADING_REVEAL_DELAY}
    >
      <Spinner className="size-icon-md motion-safe:animate-spin-slow" />
      {label}
    </div>
  );
}

export function PreviewBusyChip({ label }: { label: string }) {
  return (
    <div
      className="absolute right-3 top-3 flex items-center gap-1.5 rounded-sm bg-raised px-2 py-1 text-caption text-muted shadow-sm motion-safe:animate-fade-in"
      style={LOADING_REVEAL_DELAY}
    >
      <Spinner className="size-3 motion-safe:animate-spin-slow" />
      {label}
    </div>
  );
}

export function PreviewProblem({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <AlertTriangle className="size-icon-lg text-warning" />
      <p className="max-w-sm text-subheading text-primary">{title}</p>
      {detail && <p className="max-w-sm break-words text-body text-muted">{detail}</p>}
      {children}
    </div>
  );
}
