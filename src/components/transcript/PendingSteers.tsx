import { useStoreSelector } from '../../hooks/useStore';
import { sendSteerNow } from '../../lib/commands';
import { UserBubble } from './UserBubble';

// The steers the sidecar lists as not taken in by the model yet, as the user's
// bubbles below the transcript in the order they were sent. Each can be sent now.
export function PendingSteers({ appSessionId }: { appSessionId: string }) {
  const steers = useStoreSelector((state) =>
    Object.hasOwn(state.sessions, appSessionId)
      ? state.sessions[appSessionId].pendingSteers
      : undefined,
  );
  if (!steers) return null;
  return steers.map((steer) => (
    <div key={steer.id} className="prompt-enter mx-auto min-w-0 max-w-2xl pb-2 pt-2">
      <UserBubble
        event={{ text: steer.text }}
        onSendNow={() => {
          sendSteerNow(appSessionId, steer.id);
        }}
      />
    </div>
  ));
}
