import type { SessionSummary, TranscriptEvent } from '../types/bridge';
import { sessionIsLive } from '../lib/sessions';

// A steer the user sent into a running turn. It is not a transcript row: the
// chat shows it as the user's bubble below the transcript until the model
// takes it in, and the sidecar then adds the row where that happened. The
// sidecar owns whether it is still pending; this keeps what the bubble shows.
export interface SentSteer {
  steerId: string;
  event: TranscriptEvent;
  // The sidecar has listed it as pending at least once.
  listed: boolean;
}

export type SentSteers = Record<string, SentSteer[] | undefined>;

export function addSentSteer(
  sentSteers: SentSteers,
  appSessionId: string,
  steer: Omit<SentSteer, 'listed'>,
): SentSteers {
  const sent = sentSteers[appSessionId] ?? [];
  return { ...sentSteers, [appSessionId]: [...sent, { ...steer, listed: false }] };
}

// A bubble goes once the summary stops listing its steer: delivered, taken
// back by a Stop, or run as a turn of its own. One not listed yet stays while
// the chat is live, because the sidecar may not have seen it; once the chat
// is idle it can only run as a turn of its own, which adds its own row.
export function reconcileSentSteers(sentSteers: SentSteers, session: SessionSummary): SentSteers {
  const sent = sentSteers[session.appSessionId];
  if (!sent) return sentSteers;
  const pending = new Set(session.pendingSteers);
  const live = sessionIsLive(session);
  const kept = sent.flatMap((steer) => {
    if (pending.has(steer.steerId)) return [steer.listed ? steer : { ...steer, listed: true }];
    return steer.listed || !live ? [] : [steer];
  });
  const unchanged = kept.length === sent.length && kept.every((steer, i) => steer === sent[i]);
  if (unchanged) return sentSteers;
  return { ...sentSteers, [session.appSessionId]: kept.length > 0 ? kept : undefined };
}
