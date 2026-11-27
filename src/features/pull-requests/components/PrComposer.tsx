import { useEffect, useRef } from 'react';

import { CompactComposer } from '../../../components/composer/CompactComposer';

const MAX_HEIGHT = 200;

// The same small composer as design mode's prompt and the side chat. Enter
// posts, Shift+Enter adds a line.
export function PrComposer({
  draft,
  posting,
  onDraftChange,
  onSubmit,
}: {
  draft: string;
  posting: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const postingRef = useRef(false);

  useEffect(() => {
    if (!posting) postingRef.current = false;
  }, [posting]);

  const canSend = draft.trim().length > 0 && !posting;

  const submit = () => {
    if (!canSend || postingRef.current) return;
    postingRef.current = true;
    onSubmit();
  };

  return (
    <CompactComposer
      value={draft}
      onChange={onDraftChange}
      onSend={submit}
      canSend={canSend}
      placeholder="Leave a comment"
      label="Leave a comment"
      sendLabel="Comment"
      maxHeight={MAX_HEIGHT}
      status={
        posting ? (
          <span className="shrink-0 self-center text-caption text-muted">Posting…</span>
        ) : null
      }
    />
  );
}
