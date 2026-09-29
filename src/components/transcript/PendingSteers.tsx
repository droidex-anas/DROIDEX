import { useStoreSelector } from '../../hooks/useStore';
import { sendSteerNow } from '../../lib/commands';
import { UserBubble } from './UserBubble';

// The steers the model has not taken in yet, as the user's bubbles below the
// transcript in the order they were sent. Each can be sent now.
export function PendingSteers({ appSessionId }: { appSessionId: string }) {
  const steers = useStoreSelector((state) => state.sentSteers[appSessionId]);
  if (!steers) return null;
  return steers.map((steer) => (
    <div key={steer.steerId} className="prompt-enter mx-auto min-w-0 max-w-2xl pb-2 pt-2">
      <UserBubble
        event={steer.event}
        onSendNow={() => {
          sendSteerNow(appSessionId, steer.steerId);
        }}
      />
    </div>
  ));
}
