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
// Each chat's composer, which a taken-back steer returns to.
const composers = new Map<string, (prompt: QueuedPrompt) => void>();
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
  steers.set(
    appSessionId,
    current.filter((steer) => !ids.has(steer.id)),
  );
  emit();
}

// Keeps a chat's saved prompts only for steers still pending in it.
export function retainSteerPrompts(appSessionId: string, pending: ReadonlySet<string>): void {
  for (const [id, saved] of prompts)
    if (saved.appSessionId === appSessionId && !pending.has(id)) prompts.delete(id);
}

export function localSteersOf(appSessionId: string): readonly LocalSteer[] {
  return steers.get(appSessionId) ?? EMPTY;
}

export function subscribeLocalSteers(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function registerComposer(
  appSessionId: string,
  restore: (prompt: QueuedPrompt) => void,
): () => void {
  composers.set(appSessionId, restore);
  return () => {
    if (composers.get(appSessionId) === restore) composers.delete(appSessionId);
  };
}

// Returns false when nothing could take the prompt back, so the caller can
// fall back to seeding the text alone.
export function restoreSteerToComposer(appSessionId: string, steerId: string): boolean {
  const saved = prompts.get(steerId);
  const restore = composers.get(appSessionId);
  if (!saved || !restore) return false;
  prompts.delete(steerId);
  restore(saved.prompt);
  return true;
}
