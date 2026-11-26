import { useCallback, useMemo } from 'react';

import { useStoreDispatch, useStoreSelector } from '../../../hooks/useStore';
import type { DiffLineTarget } from '../../../components/environment/DiffBody';
import { emptyPrReviewDraft, type PrReviewDraft } from '../lib/prAnnotations';
import { prReviewKey } from '../lib/prReviewState';

// The review draft (line annotations and viewed-file marks) for one pull
// request, backed by the root store so it survives leaving the workspace and
// the summary/code tab switch. Never persisted: it is reading state.
export function usePrReviewDraft(cwd: string, number: number) {
  const dispatch = useStoreDispatch();
  const key = prReviewKey(cwd, number);
  const draft = useStoreSelector((state) => state.prReviewDrafts[key]) ?? emptyPrReviewDraft;

  const addNote = useCallback(
    (target: DiffLineTarget & { path: string }, body: string) => {
      dispatch({
        type: 'PR_REVIEW_NOTE_ADD',
        key,
        annotation: {
          path: target.path,
          side: target.side,
          line: target.line,
          code: target.text,
          body,
        },
      });
    },
    [dispatch, key],
  );

  const updateNote = useCallback(
    (id: string, body: string) => {
      dispatch({ type: 'PR_REVIEW_NOTE_UPDATE', key, id, body });
    },
    [dispatch, key],
  );

  const removeNote = useCallback(
    (id: string) => {
      dispatch({ type: 'PR_REVIEW_NOTE_REMOVE', key, id });
    },
    [dispatch, key],
  );

  const clearNotes = useCallback(() => {
    dispatch({ type: 'PR_REVIEW_NOTES_CLEAR', key });
  }, [dispatch, key]);

  const toggleViewed = useCallback(
    (path: string) => {
      dispatch({ type: 'PR_FILE_VIEWED_TOGGLE', key, path });
    },
    [dispatch, key],
  );

  return useMemo(
    (): {
      draft: PrReviewDraft;
      addNote: (target: DiffLineTarget & { path: string }, body: string) => void;
      updateNote: (id: string, body: string) => void;
      removeNote: (id: string) => void;
      clearNotes: () => void;
      toggleViewed: (path: string) => void;
    } => ({
      draft,
      addNote,
      updateNote,
      removeNote,
      clearNotes,
      toggleViewed,
    }),
    [draft, addNote, updateNote, removeNote, clearNotes, toggleViewed],
  );
}
