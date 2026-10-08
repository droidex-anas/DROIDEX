import { Suspense, useEffect, useSyncExternalStore } from 'react';
import { threadReports } from '../../features/projects/threadNotices';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { sendSteerNow, withdrawSteer } from '../../lib/commands';
import { dropLocalSteers, localSteersOf, subscribeLocalSteers } from '../../lib/localSteers';
import { sessionIsLive } from '../../lib/sessions';
import { toast } from '../../lib/toast';
import { ThreadReportNotice } from '../chat';
import { PromptActions } from './ResponseActions';
import { UserBubble } from './UserBubble';

// The steers the sidecar lists as not taken in by the model yet, below the
// transcript in the order they were sent. Each can be sent now. The user's own
// is their bubble; a message from another chat is the notice it becomes once
// the model takes it in, by the same rule the transcript row uses.
// A steer this window just sent shows at once, before the sidecar lists it.
export function PendingSteers({ appSessionId }: { appSessionId: string }) {
  const listed = useStoreSelector((state) =>
    Object.hasOwn(state.sessions, appSessionId)
      ? state.sessions[appSessionId].pendingSteers
      : undefined,
  );
  const dispatch = useStoreDispatch();
  const local = useSyncExternalStore(subscribeLocalSteers, () => localSteersOf(appSessionId));
  const live = useStoreSelector(
    (state) =>
      Object.hasOwn(state.sessions, appSessionId) && sessionIsLive(state.sessions[appSessionId]),
  );
  // Read only while a local steer waits, so streaming text does not re-render this.
  const transcript = useStoreSelector((state) =>
    local.length > 0 ? state.transcripts[appSessionId] : undefined,
  );
  useEffect(() => {
    if (local.length === 0) return;
    // A local steer is settled once the sidecar lists it, once the message it
    // became lands in the transcript, or once the chat stops without either.
    const listedIds = new Set(listed?.map((steer) => steer.id));
    const settled = new Set<string>();
    const earliest = Math.min(...local.map((steer) => steer.sentAt));
    const delivered: string[] = [];
    for (let i = (transcript?.length ?? 0) - 1; i >= 0; i -= 1) {
      const event = transcript?.[i];
      if (!event || event.ts < earliest) break;
      if (event.author === 'user' && event.kind === 'text' && event.text)
        delivered.push(event.text);
    }
    for (const steer of local) {
      const match = delivered.indexOf(steer.text);
      if (listedIds.has(steer.id) || !live || match >= 0) settled.add(steer.id);
      if (match >= 0) delivered.splice(match, 1);
    }
    dropLocalSteers(appSessionId, settled);
  }, [appSessionId, listed, live, local, transcript]);
  const listedIds = new Set(listed?.map((steer) => steer.id));
  const steers = [...(listed ?? []), ...local.filter((steer) => !listedIds.has(steer.id))];
  if (steers.length === 0) return null;
  return steers.map((steer) => {
    const sendNow = () => {
      sendSteerNow(appSessionId, steer.id);
    };
    // Only once the harness confirms the model cannot see it does the text go
    // back to the composer; otherwise it would arrive twice.
    const withdraw = async () => {
      const { withdrawn } = await withdrawSteer(appSessionId, steer.id).catch(() => ({
        withdrawn: false,
      }));
      if (withdrawn)
        dispatch({ type: 'SEED_COMPOSER', text: steer.text, appSessionId, focus: true });
      else toast.info('The agent already has this message.');
    };
    const canWithdraw = 'canWithdraw' in steer && steer.canWithdraw;
    const reports = threadReports(steer.text);
    return (
      <div key={steer.id} className="prompt-enter mx-auto min-w-0 max-w-2xl pb-2 pt-2">
        {reports ? (
          <div className="group/msg relative">
            <Suspense fallback={null}>
              <ThreadReportNotice reports={reports} />
            </Suspense>
            <PromptActions
              text={reports.map((report) => report.body).join('\n\n')}
              onSendNow={sendNow}
            />
          </div>
        ) : (
          <UserBubble
            event={{ text: steer.text }}
            onSendNow={sendNow}
            onWithdraw={
              canWithdraw
                ? () => {
                    void withdraw();
                  }
                : undefined
            }
          />
        )}
      </div>
    );
  });
}
