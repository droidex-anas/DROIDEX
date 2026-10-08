import { Suspense, useEffect, useRef, useSyncExternalStore } from 'react';
import { threadReports } from '../../features/projects/threadNotices';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { sendSteerNow, withdrawSteer } from '../../lib/commands';
import {
  dropLocalSteers,
  localSteersOf,
  retainSteerPrompts,
  restoreSteerToComposer,
  subscribeLocalSteers,
} from '../../lib/localSteers';
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
  // One take-back per steer at a time, so a double click cannot restore it twice.
  const withdrawing = useRef(new Set<string>());
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
    // became lands in the transcript under its id, or once the chat stops.
    const listedIds = new Set(listed?.map((steer) => steer.id));
    const earliest = Math.min(...local.map((steer) => steer.sentAt));
    const delivered = new Set<string>();
    for (let i = (transcript?.length ?? 0) - 1; i >= 0; i -= 1) {
      const event = transcript?.[i];
      if (!event || event.ts < earliest) break;
      if (event.steerId) delivered.add(event.steerId);
    }
    const settled = new Set(
      local
        .filter((steer) => listedIds.has(steer.id) || delivered.has(steer.id) || !live)
        .map((steer) => steer.id),
    );
    dropLocalSteers(appSessionId, settled);
  }, [appSessionId, listed, live, local, transcript]);
  useEffect(() => {
    const pending = new Set([...(listed ?? []), ...local].map((steer) => steer.id));
    retainSteerPrompts(appSessionId, pending);
  }, [appSessionId, listed, local]);
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
      if (withdrawing.current.has(steer.id)) return;
      withdrawing.current.add(steer.id);
      const { withdrawn } = await withdrawSteer(appSessionId, steer.id).catch(() => ({
        withdrawn: false,
      }));
      withdrawing.current.delete(steer.id);
      if (!withdrawn) {
        toast.info('The agent already has this message.');
        return;
      }
      // Its chips and replies come back with it when this window sent it.
      if (!restoreSteerToComposer(appSessionId, steer.id))
        dispatch({ type: 'SEED_COMPOSER', text: steer.text, appSessionId, focus: true });
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
