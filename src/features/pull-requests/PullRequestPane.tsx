import { useStoreDispatch } from '../../hooks/useStore';
import { PrDetail } from './components/PrDetail';
import { formatAnnotationsForPrompt, orderedAnnotations } from './lib/prAnnotations';
import { prChatSeed } from './lib/prChatSeed';
import { droidReviewSeed } from './lib/prReview';
import { prReviewKey } from './lib/prReviewState';

// One pull request inside the utility pane, opened from a link. Unlike the
// workspace detail there is no inbox behind it: the detail hook fetches
// everything, and the chat actions never leave the session view — the pane is
// beside the chat, so CLOSE_PULL_REQUESTS would only close a workspace that
// is not on screen.
export function PullRequestPane({ cwd, number }: { cwd: string; number: number }) {
  const dispatch = useStoreDispatch();
  return (
    <PrDetail
      compact
      cwd={cwd}
      number={number}
      pr={null}
      viewerLogin={null}
      onOpenChat={(pr) => {
        dispatch({ type: 'START_CHAT', cwd, executionMode: 'local' });
        dispatch({ type: 'SEED_COMPOSER', text: prChatSeed(pr), replace: true });
      }}
      onReviewWithDroid={(pr) => {
        dispatch({ type: 'START_CHAT', cwd, executionMode: 'local' });
        dispatch({ type: 'SEED_COMPOSER', text: droidReviewSeed(pr), replace: true });
      }}
      onSendReview={(pr, annotations) => {
        const key = prReviewKey(cwd, number);
        dispatch({ type: 'START_CHAT', cwd, executionMode: 'local' });
        dispatch({
          type: 'SEED_COMPOSER',
          text: formatAnnotationsForPrompt(pr, orderedAnnotations(annotations)),
          replace: true,
        });
        dispatch({ type: 'PR_REVIEW_NOTES_CLEAR', key });
      }}
    />
  );
}
