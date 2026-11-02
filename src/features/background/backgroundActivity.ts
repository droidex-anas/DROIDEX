import { isCommandStillRunning } from '../../components/transcript/liveProcessesContext';
import { correlateResults } from '../../components/transcript/rows';
import { shellCommandOf, toolMeta } from '../../lib/tools';
import type { AgentProcess, TranscriptEvent } from '../../types/bridge';

/* What the Background tab knows about a chat's commands: the processes they
   left running, which come from the sidecar's process scan, and the commands
   that have finished, which come from the transcript every harness writes. */

export interface FinishedCommand {
  id: string;
  command: string;
  outcome: 'succeeded' | 'failed' | 'interrupted';
  endedAt: number;
  durationMs: number;
}

// Newest first. A call without its result is still running and belongs to the
// transcript's live row, not to the history.
export function finishedCommands(
  transcript: readonly TranscriptEvent[],
  processes: readonly AgentProcess[],
): FinishedCommand[] {
  const primary = transcript.filter((event) => event.role === 'primary');
  const { resultByCall } = correlateResults(primary);
  const finished: FinishedCommand[] = [];
  for (let index = primary.length - 1; index >= 0; index -= 1) {
    const call = primary[index];
    if (call.kind !== 'tool_call' || toolMeta(call.toolName, call.toolArgs).cat !== 'exec')
      continue;
    const result = resultByCall.get(call);
    const command = shellCommandOf(call.toolArgs);
    if (!result || !command) continue;
    // Only a process this call could have started keeps it running; an earlier
    // run of the same command does not. `ps` start times are second-granular.
    const startedSince = processes.filter((process) => process.startedAt >= call.ts - 1000);
    if (isCommandStillRunning(command, startedSince)) continue;
    finished.push({
      id: call.id,
      command,
      outcome: commandOutcome(result),
      endedAt: result.ts,
      durationMs: Math.max(0, result.ts - call.ts),
    });
  }
  return finished;
}

function commandOutcome(result: TranscriptEvent): FinishedCommand['outcome'] {
  if (result.interrupted) return 'interrupted';
  return result.isError ? 'failed' : 'succeeded';
}

// `ps` joins a shell's arguments with spaces, so what the agent typed is
// everything after the shell's command flag: `/bin/zsh -lc npm run dev` ran
// `npm run dev`. A shell that exec'd its command leaves only the process.
export function commandTypedByAgent(process: AgentProcess): string {
  if (process.originCommand === undefined) return process.name;
  const words = process.originCommand.trim().split(/\s+/);
  for (let index = 1; index < words.length; index += 1) {
    const word = words[index];
    if (word.startsWith('--command=')) {
      return [word.slice('--command='.length), ...words.slice(index + 1)].join(' ');
    }
    if (word === '--command' || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(word)) {
      return words.slice(index + 1).join(' ') || process.name;
    }
  }
  return process.name;
}
