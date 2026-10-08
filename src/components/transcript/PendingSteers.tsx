import { Suspense, useEffect, useSyncExternalStore } from 'react';
import { threadReports } from '../../features/projects/threadNotices';
import { useStoreDispatch, useStoreSelector, type QueuedPrompt } from '../../hooks/useStore';
import { sendSteerNow, withdrawSteer } from '../../lib/commands';
import {
  beginSteerWithdrawal,
  dropLocalSteers,
  endSteerWithdrawal,
  localSteersOf,
  retainSteerPrompts,
  subscribeLocalSteers,
  takeSteerPrompt,
} from '../../lib/localSteers';
import { getRuntimeHealth, subscribeRuntimeHealth } from '../../lib/runtimeHealth';
import { sessionIsLive } from '../../lib/sessions';
import { toast } from '../../lib/toast';
import type { ProviderMention, TranscriptEvent } from '../../types/bridge';
import { ThreadReportNotice } from '../chat';
import { PromptActions } from './ResponseActions';
import { UserBubble } from './UserBubble';

// How far back a delivered steer's row is looked for.
const RECENT_EVENTS = 500;

// Steer ids the recent transcript holds a delivered row for. Late output can
// carry older timestamps than the steer that followed it, so the scan covers
// the recent tail rather than stopping at the first older row.
function deliveredSteerIds(transcript: readonly TranscriptEvent[] | undefined): Set<string> {
  const delivered = new Set<string>();
  const tail = transcript ?? [];
  for (let i = tail.length - 1; i >= Math.max(0, tail.length - RECENT_EVENTS); i -= 1) {
    const id = tail[i]?.steerId;
    if (id) delivered.add(id);
  }
  return delivered;
}

// The steers the sidecar lists as not taken in by the model yet, below the
// transcript in the order they were sent, plus one this window just sent and
// the sidecar has not listed yet. Listed steers can be sent now. The user's own
// is their bubble; a message from another chat is the notice it becomes once
// the model takes it in, by the same rule the transcript row uses.
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
  // Read only while something here waits on it, so streaming text does not
  // re-render this.
  const transcript = useStoreSelector((state) =>
    local.length > 0 ? state.transcripts[appSessionId] : undefined,
  );

  // A taken-back steer always returns as a whole prompt, so the composer only
  // adds it to whatever draft is there. Without the saved prompt (after a
  // reload) the sidecar's text stands in; with neither there is nothing to add.
  const restore = (steerId: string, text?: string, mentions?: ProviderMention[]) => {
    endSteerWithdrawal(steerId);
    const saved = takeSteerPrompt(steerId);
    const prompt: QueuedPrompt | undefined =
      saved ??
      (text === undefined
        ? undefined
        : { id: steerId, text, skills: [], files: [], ...(mentions ? { mentions } : {}) });
    if (!prompt) return;
    dispatch({ type: 'SEED_COMPOSER', text: prompt.text, appSessionId, focus: true, prompt });
  };

  useEffect(() => {
    if (local.length === 0) return;
    const listedIds = new Set(listed?.map((steer) => steer.id));
    const delivered = deliveredSteerIds(transcript);
    // A local steer is settled once the sidecar lists it, once the message it
    // became lands under its id, or once the chat stops.
    dropLocalSteers(
      appSessionId,
      new Set(
        local
          .filter((steer) => listedIds.has(steer.id) || delivered.has(steer.id) || !live)
          .map((steer) => steer.id),
      ),
    );
  }, [appSessionId, listed, live, local, transcript]);

  useEffect(() => {
    const pending = new Set([...(listed ?? []), ...local].map((steer) => steer.id));
    retainSteerPrompts(appSessionId, pending);
  }, [appSessionId, listed, local]);

  const listedIds = new Set(listed?.map((steer) => steer.id));
  const steers = [...(listed ?? []), ...local.filter((steer) => !listedIds.has(steer.id))];
  if (steers.length === 0) return null;
  return steers.map((steer) => {
    const isListed = listedIds.has(steer.id);
    const sendNow = isListed
      ? () => {
          sendSteerNow(appSessionId, steer.id);
        }
      : undefined;
    // Only once the harness confirms the model cannot see it does the text go
    // back to the composer; otherwise it would arrive twice.
    const withdraw = async () => {
      // One take-back per steer at a time, so a double click cannot restore it twice.
      if (!beginSteerWithdrawal(steer.id)) return;
      for (;;) {
        // Observe reconnect before sending, so even a quick disconnect/reconnect is retained.
        let stopWatching: () => void = () => undefined;
        const reconnected = new Promise<void>((resolve) => {
          let connected = getRuntimeHealth().transport === 'connected';
          stopWatching = subscribeRuntimeHealth(() => {
            const nextConnected = getRuntimeHealth().transport === 'connected';
            if (!connected && nextConnected) {
              stopWatching();
              resolve();
            }
            connected = nextConnected;
          });
        });
        const result = await withdrawSteer(appSessionId, steer.id);
        if ('lost' in result) {
          // Keep the prompt marked across chat switches and retry once per reconnect.
          await reconnected;
          continue;
        }
        stopWatching();
        if (result.withdrawn) {
          // The sidecar's text is the whole prompt; the listed one is shortened.
          restore(steer.id, result.text ?? steer.text, result.mentions);
          return;
        }
        endSteerWithdrawal(steer.id);
        toast.info('The agent already has this message.');
        return;
      }
    };
    const canWithdraw = isListed && 'canWithdraw' in steer && steer.canWithdraw;
    const onWithdraw = canWithdraw
      ? () => {
          void withdraw();
        }
      : undefined;
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
              onWithdraw={onWithdraw}
            />
          </div>
        ) : (
          <UserBubble event={{ text: steer.text }} onSendNow={sendNow} onWithdraw={onWithdraw} />
        )}
      </div>
    );
  });
}
