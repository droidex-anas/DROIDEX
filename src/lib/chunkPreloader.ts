import { LAZY_SURFACE_LOADERS, type LazySurface } from './lazySurfaces';

type IdleCallbackHandle = number;

const warmed = new Set<LazySurface>();
const intentCleanups = new Map<LazySurface, () => void>();
const loaderCalls = new Map<LazySurface, number>();
let idleHandle: IdleCallbackHandle | null = null;
let idleGeneration = 0;
let loaderOverride: Partial<Record<LazySurface, () => Promise<unknown>>> | null = null;

const IDLE_SURFACES: LazySurface[] = [
  'settings',
  'commandPalette',
  'files',
  'terminal',
  'review',
  'browser',
  'agents',
];

export function preloadLazySurface(surface: LazySurface): void {
  if (warmed.has(surface)) return;
  warmed.add(surface);
  loaderCalls.set(surface, (loaderCalls.get(surface) ?? 0) + 1);
  void (loaderOverride?.[surface] ?? LAZY_SURFACE_LOADERS[surface])().catch(() => {
    warmed.delete(surface);
  });
}

export function bindLazySurfaceIntent(
  surface: LazySurface,
  element: HTMLElement | null,
): () => void {
  const existing = intentCleanups.get(surface);
  existing?.();
  intentCleanups.delete(surface);

  if (!element) return () => undefined;

  const warm = () => {
    preloadLazySurface(surface);
  };
  element.addEventListener('pointerenter', warm, { passive: true });
  element.addEventListener('focusin', warm, { passive: true });

  const cleanup = () => {
    element.removeEventListener('pointerenter', warm);
    element.removeEventListener('focusin', warm);
    intentCleanups.delete(surface);
  };
  intentCleanups.set(surface, cleanup);
  return cleanup;
}

export function scheduleIdleLazyWarmup(isBusy: () => boolean): void {
  if (idleHandle !== null) return;
  const generation = idleGeneration;

  let index = 0;
  const run = (deadline?: IdleDeadline) => {
    if (generation !== idleGeneration) return;
    idleHandle = null;
    // The app schedules again when work settles; do not poll during a turn.
    if (isBusy()) return;
    if (!deadline || deadline.timeRemaining() > 0) {
      while (index < IDLE_SURFACES.length && warmed.has(IDLE_SURFACES[index])) index += 1;
      if (index < IDLE_SURFACES.length) preloadLazySurface(IDLE_SURFACES[index++]);
    }
    if (index < IDLE_SURFACES.length) schedule();
  };

  const requestIdle = (
    globalThis as {
      requestIdleCallback?: (callback: (deadline: IdleDeadline) => void) => number;
    }
  ).requestIdleCallback;

  const schedule = () => {
    idleHandle = requestIdle
      ? requestIdle(run)
      : (setTimeout(run, 1_500) as unknown as IdleCallbackHandle);
  };
  schedule();
}

export function cancelIdleLazyWarmup(): void {
  idleGeneration += 1;
  if (idleHandle === null) return;
  const handle = idleHandle;
  idleHandle = null;
  const cancelIdle = (globalThis as { cancelIdleCallback?: (handle: number) => void })
    .cancelIdleCallback;
  if (cancelIdle) cancelIdle(handle);
  else clearTimeout(handle);
}

/** @internal Reset module state for deterministic tests. */
export function __resetChunkPreloaderForTest(options?: {
  loaders?: Partial<Record<LazySurface, () => Promise<unknown>>>;
}): void {
  for (const cleanup of intentCleanups.values()) cleanup();
  intentCleanups.clear();
  cancelIdleLazyWarmup();
  warmed.clear();
  loaderCalls.clear();
  loaderOverride = options?.loaders ?? null;
  idleGeneration += 1;
}

/** @internal Count loader invocations per surface during tests. */
export function __loaderCallsForTest(): ReadonlyMap<LazySurface, number> {
  return loaderCalls;
}
