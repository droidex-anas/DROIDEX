import { comparablePath } from '../../../lib/pathComparison';
import {
  addAnnotation,
  emptyPrReviewDraft,
  removeAnnotation,
  toggleViewedFile,
  updateAnnotationBody,
  type PrLineAnnotation,
  type PrReviewDraft,
} from './prAnnotations';

// Review drafts are per pull request and session-scoped: annotations and
// viewed-file marks are reading state, worthless after a restart, so unlike
// the backlog they are not persisted. The key is the checkout plus number —
// stable before the pull request's metadata loads, unlike its url.
export function prReviewKey(cwd: string, number: number): string {
  return `${comparablePath(cwd)}#${String(number)}`;
}

export type PrReviewAction =
  | { type: 'PR_REVIEW_NOTE_ADD'; key: string; annotation: Omit<PrLineAnnotation, 'id'> }
  | { type: 'PR_REVIEW_NOTE_UPDATE'; key: string; id: string; body: string }
  | { type: 'PR_REVIEW_NOTE_REMOVE'; key: string; id: string }
  | { type: 'PR_REVIEW_NOTES_CLEAR'; key: string }
  | { type: 'PR_FILE_VIEWED_TOGGLE'; key: string; path: string };

export interface PrReviewSlice {
  prReviewDrafts: Record<string, PrReviewDraft | undefined>;
}

function withDraft(
  state: PrReviewSlice,
  key: string,
  update: (draft: PrReviewDraft) => PrReviewDraft,
): PrReviewSlice['prReviewDrafts'] | null {
  const current = state.prReviewDrafts[key] ?? emptyPrReviewDraft;
  const next = update(current);
  if (next === current) return null;
  if (next.annotations.length === 0 && next.viewedFiles.length === 0) {
    if (!(key in state.prReviewDrafts)) return null;
    const rest = { ...state.prReviewDrafts };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- keyed removal of an emptied draft
    delete rest[key];
    return rest;
  }
  return { ...state.prReviewDrafts, [key]: next };
}

export function reducePrReview<S extends PrReviewSlice>(state: S, action: PrReviewAction): S {
  switch (action.type) {
    case 'PR_REVIEW_NOTE_ADD': {
      const drafts = withDraft(state, action.key, (draft) =>
        addAnnotation(draft, action.annotation),
      );
      return drafts ? { ...state, prReviewDrafts: drafts } : state;
    }
    case 'PR_REVIEW_NOTE_UPDATE': {
      const drafts = withDraft(state, action.key, (draft) =>
        updateAnnotationBody(draft, action.id, action.body),
      );
      return drafts ? { ...state, prReviewDrafts: drafts } : state;
    }
    case 'PR_REVIEW_NOTE_REMOVE': {
      const drafts = withDraft(state, action.key, (draft) => removeAnnotation(draft, action.id));
      return drafts ? { ...state, prReviewDrafts: drafts } : state;
    }
    case 'PR_REVIEW_NOTES_CLEAR': {
      const current = state.prReviewDrafts[action.key];
      if (!current || current.annotations.length === 0) return state;
      const drafts = withDraft(state, action.key, (draft) => ({ ...draft, annotations: [] }));
      return drafts ? { ...state, prReviewDrafts: drafts } : state;
    }
    case 'PR_FILE_VIEWED_TOGGLE': {
      const drafts = withDraft(state, action.key, (draft) => toggleViewedFile(draft, action.path));
      return drafts ? { ...state, prReviewDrafts: drafts } : state;
    }
  }
}
