import { lazy, Suspense, useId } from 'react';
import { AppBlockErrorFallback } from './AppBlockErrorFallback';
import { AppLoadingSurface } from './AppLoadingSurface';

// Apps are rare in a transcript, so the frame, its document, and its runtime
// load with the first one instead of on the entry.
const RunningAppFrame = lazy(() =>
  import('./AppBlockFrame').then((module) => ({ default: module.RunningAppFrame })),
);

export function AppBlock({
  source,
  isBuilding = false,
  isCutOff = false,
}: {
  source: string;
  isBuilding?: boolean;
  // The stored source lost its closing fence, so this App can never run. It
  // outranks every other state: incomplete source must not execute.
  isCutOff?: boolean;
}) {
  const instanceId = useId();

  if (isCutOff) {
    return (
      <AppBlockErrorFallback
        message="Saved history kept only part of this App's source."
        source={source}
      />
    );
  }

  return (
    <div className="my-3 min-w-0">
      {isBuilding ? (
        <AppLoadingSurface title="Building interactive app" />
      ) : (
        <Suspense fallback={<AppLoadingSurface title="Starting interactive app" />}>
          <RunningAppFrame key={source} source={source} instanceId={instanceId} />
        </Suspense>
      )}
    </div>
  );
}
