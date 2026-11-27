import { useStoreDispatch } from '../../hooks/useStore';
import { PrDetail } from './components/PrDetail';
import { formatAnnotationsForPrompt, orderedAnnotations } from './lib/prAnnotations';
import { prChatSeed } from './lib/prChatSeed';
import { droidReviewSeed } from './lib/prReview';
import { prReviewKey } from './lib/prReviewState';

// One pull request inside a chat's utility pane, opened from a link. The pane
// sits beside that chat, so every chat action goes to it rather than to a new
// chat: review prompts send there, and Chat drafts the pull request into its
// composer.
export function PullRequestPane({
  appSessionId,
  cwd,
  number,
}: {
  appSessionId: string;
  cwd: string;
  number: number;
}) {
  const dispatch = useStoreDispatch();
  return (
    <PrDetail
      compact
      cwd={cwd}
      number={number}
      pr={null}
      onOpenChat={(pr) => {
        dispatch({ type: 'SEED_COMPOSER', appSessionId, text: prChatSeed(pr) });
      }}
      onReviewWithDroid={(pr) => {
        dispatch({ type: 'SEED_COMPOSER', appSessionId, text: droidReviewSeed(pr), send: true });
      }}
      onSendReview={(pr, annotations) => {
        dispatch({
          type: 'SEED_COMPOSER',
          appSessionId,
          text: formatAnnotationsForPrompt(pr, orderedAnnotations(annotations)),
          send: true,
        });
        dispatch({ type: 'PR_REVIEW_NOTES_CLEAR', key: prReviewKey(cwd, number) });
      }}
    />
  );
}
