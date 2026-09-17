import { useRef } from 'react';
import type { ChildSessionSummary, TranscriptEvent } from '../../types/bridge';
import { isChildSessionTool } from '../../lib/childSessionEvents';
import { scopeTranscriptToAgent } from '../../lib/transcript';

/* One agent's own events out of the chat's interleaved transcript.

   The harness echoes the spawn into the child's stream: a tool row carrying the
   prompt the pane already opens with. It is dropped here so the task is shown
   once, as the message the parent sent. A spawn the agent makes itself carries a
   different prompt and stays.

   The chat's transcript changes on every token of any agent. The scoped array
   keeps its identity while this agent's own events have not changed, so the
   feed below it only rebuilds when this agent moves. */
export function useAgentTranscript(
  transcript: readonly TranscriptEvent[],
  child: ChildSessionSummary,
): TranscriptEvent[] {
  const previous = useRef<TranscriptEvent[]>([]);
  const scoped = scopeTranscriptToAgent(transcript, child.childSessionId).filter(
    (event) => !isSpawnEcho(event, child.prompt),
  );
  const last = previous.current;
  const unchanged =
    scoped.length === last.length && scoped.every((event, index) => event === last[index]);
  if (!unchanged) previous.current = scoped;
  return previous.current;
}

function isSpawnEcho(event: TranscriptEvent, prompt: string | undefined): boolean {
  if (event.kind !== 'tool_call' && event.kind !== 'tool_result') return false;
  if (!isChildSessionTool(event.toolName, event.toolArgs)) return false;
  const args = event.toolArgs;
  const echoed: unknown =
    typeof args === 'object' && args !== null ? Reflect.get(args, 'prompt') : undefined;
  return prompt !== undefined && typeof echoed === 'string' && echoed.trim() === prompt.trim();
}
