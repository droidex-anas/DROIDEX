import { MessageBubble } from '@droidex/icons';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { sessionIsLive } from '../../lib/sessions';
import { isSideChatOf } from '../../lib/sideChats';

/* Minimized side chats wait in the window toolbar, where they never cover the
   transcript or the composer. */

export function SideChatRestoreButton({ sourceAppSessionId }: { sourceAppSessionId: string }) {
  const dispatch = useStoreDispatch();
  const working = useStoreSelector((current) =>
    Object.values(current.sessions).some(
      (session) => isSideChatOf(session, sourceAppSessionId) && sessionIsLive(session),
    ),
  );
  const label = working ? 'Side chat working' : 'Show side chats';

  return (
    <button
      type="button"
      onClick={() => {
        dispatch({ type: 'PLACE_SIDE_CHATS', sourceAppSessionId, placement: 'floating' });
      }}
      aria-label={label}
      title={label}
      className={`rounded-md p-1.5 transition-colors hover:bg-droid-elevated/60 hover:text-droid-text ${
        working ? 'animate-pulse text-droid-text' : 'text-droid-text-muted/70'
      }`}
    >
      <MessageBubble className="h-4 w-4" />
    </button>
  );
}
