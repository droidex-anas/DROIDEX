// Steers this window sent and the sidecar has not listed yet. The composer
// shows the bubble the moment the user presses send; the sidecar's list of
// pending steers takes over once it arrives.
export interface LocalSteer {
  id: string;
  text: string;
  sentAt: number;
}

const steers = new Map<string, readonly LocalSteer[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly LocalSteer[] = [];

function emit(): void {
  for (const listener of listeners) listener();
}

export function addLocalSteer(appSessionId: string, steer: LocalSteer): void {
  steers.set(appSessionId, [...(steers.get(appSessionId) ?? EMPTY), steer]);
  emit();
}

export function dropLocalSteers(appSessionId: string, ids: ReadonlySet<string>): void {
  const current = steers.get(appSessionId);
  if (!current?.some((steer) => ids.has(steer.id))) return;
  steers.set(
    appSessionId,
    current.filter((steer) => !ids.has(steer.id)),
  );
  emit();
}

export function localSteersOf(appSessionId: string): readonly LocalSteer[] {
  return steers.get(appSessionId) ?? EMPTY;
}

export function subscribeLocalSteers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
