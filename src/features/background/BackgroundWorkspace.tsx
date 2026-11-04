import { useEffect, useMemo, useState } from 'react';
import { Moon } from '@droidex/icons';
import { ActivityStatusGlyph } from '../../components/ActivityStatusGlyph';
import { Button } from '../../components/ui/Button';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { isWorkingAgent } from '../../lib/childSessions';
import { openBrowser, stopAgentProcess } from '../../lib/commands';
import { sessionIsLive } from '../../lib/sessions';
import { formatRelativeTime } from '../../lib/time';
import { formatDuration } from '../../lib/tools';
import type { AgentProcess, TranscriptEvent } from '../../types/bridge';
import { finishedCommands, type FinishedCommand } from './backgroundActivity';
import { ProcessCard } from './ProcessCard';

/* The Background tab of the utility panel: what a chat left running after its
   turn, and the commands it has already finished. While the chat sleeps on
   agents it started, a card says so, so a quiet chat never reads as a stopped
   one. */

const EARLIER_FOLD = 8;
const STOP_SETTLE_MS = 10_000;
const NO_PROCESSES: AgentProcess[] = [];
const NO_EVENTS: TranscriptEvent[] = [];

export function BackgroundWorkspace({ appSessionId }: { appSessionId: string }) {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => {
    const session = Object.hasOwn(current.sessions, appSessionId)
      ? current.sessions[appSessionId]
      : undefined;
    const children = Object.hasOwn(current.childSessions, appSessionId)
      ? Object.values(current.childSessions[appSessionId])
      : [];
    return {
      processes: current.agentProcesses[appSessionId] ?? NO_PROCESSES,
      transcript: current.transcripts[appSessionId] ?? NO_EVENTS,
      // An idle chat with agents still working is asleep: DROIDEX wakes it
      // when the last of them settles.
      sleepingOnAgents:
        session !== undefined && !sessionIsLive(session)
          ? children.filter((child) => isWorkingAgent(child, false)).length
          : 0,
    };
  }, shallowEqual);
  const { processes, transcript, sleepingOnAgents } = state;
  const now = useSecondClock(processes.length > 0);
  const earlier = useMemo(() => finishedCommands(transcript, processes), [transcript, processes]);
  // When each process was asked to stop. The bridge reports no outcome, so a
  // stop that has not taken the process away by STOP_SETTLE_MS can be retried.
  const [stopRequests, setStopRequests] = useState<ReadonlyMap<string, number>>(new Map());
  const isStopping = (process: AgentProcess) => {
    const requestedAt = stopRequests.get(processKey(process));
    return requestedAt !== undefined && now - requestedAt < STOP_SETTLE_MS;
  };

  const stop = (process: AgentProcess) => {
    setStopRequests((current) => new Map(current).set(processKey(process), Date.now()));
    stopAgentProcess(appSessionId, process.pid);
  };
  const openPort = (port: number) => {
    dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'browser', appSessionId });
    openBrowser({ appSessionId, url: `http://localhost:${String(port)}` });
  };

  return (
    <div data-testid="background-workspace" className="h-full min-h-0 overflow-y-auto pb-4">
      {sleepingOnAgents > 0 && (
        <SleepingCard
          agents={sleepingOnAgents}
          onOpenAgents={() => {
            dispatch({ type: 'OPEN_UTILITY_TOOL', tool: 'agents', appSessionId });
          }}
        />
      )}
      <SectionHeading
        label="Running"
        count={processes.length}
        action={
          processes.length > 1 ? (
            <Button
              variant="ghost"
              size="sm"
              className="min-w-0"
              onClick={() => {
                for (const process of processes) stop(process);
              }}
            >
              Stop all
            </Button>
          ) : null
        }
      />
      <div className="space-y-2 px-3">
        {processes.map((process) => (
          <ProcessCard
            key={processKey(process)}
            process={process}
            now={now}
            stopping={isStopping(process)}
            onStop={() => {
              stop(process);
            }}
            onOpenPort={openPort}
          />
        ))}
        {processes.length === 0 && (
          <p className="rounded-lg bg-surface px-3 py-2.5 text-caption text-muted">
            Nothing is running. Servers and watchers the agent starts show up here.
          </p>
        )}
      </div>
      <EarlierCommands commands={earlier} now={now} />
    </div>
  );
}

// A pid can be recycled, so a process is its pid and its start time.
function processKey(process: AgentProcess): string {
  return `${String(process.pid)}:${String(process.startedAt)}`;
}

function SleepingCard({ agents, onOpenAgents }: { agents: number; onOpenAgents: () => void }) {
  return (
    <section
      aria-label="Agent status"
      className="mx-3 mt-3 flex items-center gap-2.5 rounded-lg bg-surface p-3"
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-elevated text-secondary">
        <Moon className="size-icon-md" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body-strong text-primary">Asleep, not stopped</p>
        <p className="text-caption text-muted">
          Wakes on its own when{' '}
          {agents === 1 ? 'its agent finishes' : `its ${String(agents)} agents finish`}.
        </p>
      </div>
      <Button size="sm" variant="secondary" onClick={onOpenAgents}>
        View
      </Button>
    </section>
  );
}

function SectionHeading({
  label,
  count,
  action,
}: {
  label: string;
  count: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex h-8 items-center gap-1.5 pl-5 pr-3 pt-4 pb-1">
      <h3 className="text-label text-muted">{label}</h3>
      <span className="text-caption tabular-nums text-muted">{count}</span>
      <span className="ml-auto">{action}</span>
    </div>
  );
}

const OUTCOME = {
  succeeded: { status: 'settled', label: 'Finished' },
  failed: { status: 'failed', label: 'Failed' },
  interrupted: { status: 'interrupted', label: 'Interrupted' },
} as const;

function EarlierCommands({ commands, now }: { commands: FinishedCommand[]; now: number }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? commands : commands.slice(0, EARLIER_FOLD);
  return (
    <>
      <SectionHeading label="Earlier" count={commands.length} />
      <div className="px-3">
        {shown.map((command) => {
          const outcome = OUTCOME[command.outcome];
          return (
            <div
              key={command.id}
              data-testid="background-earlier"
              className="flex items-center gap-2.5 rounded-md px-2 py-1.5"
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                <ActivityStatusGlyph status={outcome.status} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-secondary" title={command.command}>
                  {command.command}
                </span>
                <span
                  className={`block truncate text-caption ${command.outcome === 'failed' ? 'text-danger' : 'text-muted'}`}
                >
                  {outcome.label} · {formatDuration(command.durationMs)}
                </span>
              </span>
              <span className="w-7 shrink-0 text-right text-caption tabular-nums text-muted">
                {formatRelativeTime(command.endedAt, now)}
              </span>
            </div>
          );
        })}
        {commands.length === 0 && (
          <p className="px-2 py-1.5 text-caption text-muted">
            Commands the agent runs in this chat show up here.
          </p>
        )}
        {commands.length > EARLIER_FOLD && (
          <Button
            variant="ghost"
            size="sm"
            className="ml-1 mt-1 min-w-0"
            aria-expanded={showAll}
            onClick={() => {
              setShowAll((current) => !current);
            }}
          >
            {showAll ? 'Show less' : `Show ${String(commands.length - EARLIER_FOLD)} more`}
          </Button>
        )}
      </div>
    </>
  );
}

// Elapsed times tick each second while something runs; otherwise a minute is
// fine-grained enough for "5m ago".
function useSecondClock(isTicking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(
      () => {
        setNow(Date.now());
      },
      isTicking ? 1000 : 60_000,
    );
    return () => {
      clearInterval(timer);
    };
  }, [isTicking]);
  return now;
}
