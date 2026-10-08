import type { QueuedPrompt } from '../hooks/useStore';

// Steers this window sent and the sidecar has not listed yet. The composer
// shows the bubble the moment the user presses send; the sidecar's list of
// pending steers takes over once it arrives.
export interface LocalSteer {
  id: string;
  text: string;
  sentAt: number;
}

const steers = new Map<string, readonly LocalSteer[]>();
// What the composer held for each steer, kept until the steer is delivered or
// taken back, so taking it back restores its chips and replies too.
const prompts = new Map<string, { appSessionId: string; prompt: QueuedPrompt }>();
// Steers being taken back keep their saved prompt until the answer arrives.
const withdrawing = new Set<string>();
const listeners = new Set<() => void>();
const EMPTY: readonly LocalSteer[] = [];

function emit(): void {
  for (const listener of listeners) listener();
}

export function addLocalSteer(appSessionId: string, steer: LocalSteer, prompt: QueuedPrompt): void {
  steers.set(appSessionId, [...(steers.get(appSessionId) ?? EMPTY), steer]);
  prompts.set(steer.id, { appSessionId, prompt });
  emit();
}

export function dropLocalSteers(appSessionId: string, ids: ReadonlySet<string>): void {
  const current = steers.get(appSessionId);
  if (!current?.some((steer) => ids.has(steer.id))) return;
  const remaining = current.filter((steer) => !ids.has(steer.id));
  if (remaining.length > 0) steers.set(appSessionId, remaining);
  else steers.delete(appSessionId);
  emit();
}

// Keeps a chat's saved prompts only for steers still pending in it.
export function retainSteerPrompts(appSessionId: string, pending: ReadonlySet<string>): void {
  for (const [id, saved] of prompts)
    if (saved.appSessionId === appSessionId && !pending.has(id) && !withdrawing.has(id))
      prompts.delete(id);
}

// Returns false when this steer is already being taken back.
export function beginSteerWithdrawal(steerId: string): boolean {
  if (withdrawing.has(steerId)) return false;
  withdrawing.add(steerId);
  return true;
}

export function endSteerWithdrawal(steerId: string): void {
  withdrawing.delete(steerId);
}

export function localSteersOf(appSessionId: string): readonly LocalSteer[] {
  return steers.get(appSessionId) ?? EMPTY;
}

export function subscribeLocalSteers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Hands over a steer's saved prompt once, for the composer to restore.
export function takeSteerPrompt(steerId: string): QueuedPrompt | undefined {
  const saved = prompts.get(steerId);
  prompts.delete(steerId);
  return saved?.prompt;
}
