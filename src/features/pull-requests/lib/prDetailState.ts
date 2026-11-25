import type { PrCheck, PrComment, PrCommit } from '../../../types/vcs';

export interface PrDetailState {
  cwd: string | null;
  number: number | null;
  generation: number;
  body: string;
  commits: PrCommit[];
  checks: PrCheck[];
  comments: PrComment[];
  checksError: string | null;
  commentsError: string | null;
  metaError: string | null;
  diff: string | null;
  diffError: string | null;
  diffRequested: boolean;
  loading: boolean;
  loaded: boolean;
}

export const initialPrDetailState: PrDetailState = {
  cwd: null,
  number: null,
  generation: 0,
  body: '',
  commits: [],
  checks: [],
  comments: [],
  checksError: null,
  commentsError: null,
  metaError: null,
  diff: null,
  diffError: null,
  diffRequested: false,
  loading: false,
  loaded: false,
};

export interface MetaSuccessFields {
  generation: number;
  body: string;
  commits: PrCommit[];
  checks: PrCheck[];
  comments: PrComment[];
  checksError: string | null;
  commentsError: string | null;
  metaError?: string | null;
}

export type PrDetailEvent =
  | { type: 'bind'; cwd: string | null; number: number | null }
  | { type: 'meta-start'; generation: number }
  | ({ type: 'meta-success' } & MetaSuccessFields)
  | { type: 'diff-request'; generation: number }
  | { type: 'diff-success'; generation: number; diff: string }
  | { type: 'diff-failure'; generation: number; message: string };

// Poll ticks rebuild every list from scratch even when nothing changed, and
// downstream memos (diff wiring, the timeline) key on identity. Adopt the
// previous array when the new one is field-identical, so an unchanged poll
// costs no re-render anywhere.
function shallowSameItems<T extends object>(prev: readonly T[], next: readonly T[]): boolean {
  if (prev.length !== next.length) return false;
  for (let index = 0; index < prev.length; index += 1) {
    const left = prev[index] as Record<string, unknown>;
    const right = next[index] as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    for (const key of keys) {
      const a = left[key];
      const b = right[key];
      if (a === b) continue;
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        if (a.some((item, i) => JSON.stringify(item) !== JSON.stringify(b[i]))) return false;
        continue;
      }
      return false;
    }
  }
  return true;
}

export function sharedIfUnchanged<T extends object>(prev: readonly T[], next: readonly T[]): T[] {
  // Both arrays are treated as immutable everywhere, so the unchanged case
  // keeps the previous reference itself — identity is the whole point.
  return shallowSameItems(prev, next) ? (prev as T[]) : (next as T[]);
}

export function reducePrDetail(state: PrDetailState, event: PrDetailEvent): PrDetailState {
  if (event.type === 'bind') {
    return {
      ...initialPrDetailState,
      cwd: event.cwd,
      number: event.number,
      generation: state.generation + 1,
    };
  }
  if (event.type === 'meta-start' || event.type === 'diff-request') {
    if (event.generation < state.generation) return state;
    return event.type === 'meta-start'
      ? { ...state, generation: event.generation, loading: true }
      : { ...state, generation: event.generation, diffRequested: true, diffError: null };
  }
  if (event.generation !== state.generation) return state;
  if (event.type === 'meta-success') {
    return {
      ...state,
      loading: false,
      loaded: true,
      metaError: event.metaError ?? null,
      body: event.body,
      commits: sharedIfUnchanged(state.commits, event.commits),
      checks: sharedIfUnchanged(state.checks, event.checks),
      comments: sharedIfUnchanged(state.comments, event.comments),
      checksError: event.checksError,
      commentsError: event.commentsError,
    };
  }
  if (!state.diffRequested) return state;
  if (event.type === 'diff-success') {
    return { ...state, diff: event.diff, diffError: null };
  }
  return { ...state, diffError: event.message };
}
