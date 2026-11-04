import { ExternalLink, Globe, Square } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { formatDuration } from '../../lib/tools';
import type { AgentProcess } from '../../types/bridge';
import { commandTypedByAgent } from './backgroundActivity';

/* One process a command left running: the command the agent typed, what it
   became, how long it has run, and the ports it listens on. Its mark is a
   plain dot that breathes while the process lives. */

export function ProcessCard({
  process,
  now,
  stopping,
  onStop,
  onOpenPort,
}: {
  process: AgentProcess;
  now: number;
  stopping: boolean;
  onStop: () => void;
  onOpenPort: (port: number) => void;
}) {
  const command = commandTypedByAgent(process);
  return (
    <article data-testid="background-process" className="rounded-lg bg-surface p-3">
      <div className="flex items-center gap-2.5">
        <span aria-hidden="true" className="flex w-3.5 shrink-0 justify-center">
          <span className="size-2 rounded-full bg-success motion-safe:animate-pulse" />
        </span>
        <h4 className="min-w-0 flex-1 truncate text-body-strong text-primary" title={command}>
          {command}
        </h4>
        <span className="shrink-0 text-caption tabular-nums text-muted">
          {formatDuration(now - process.startedAt)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          icon={<Square className="size-icon-sm shrink-0 fill-current" aria-hidden="true" />}
          loading={stopping}
          disabled={stopping}
          aria-label={`Stop ${command}`}
          onClick={onStop}
          className="min-w-0"
        >
          Stop
        </Button>
      </div>
      <p className="mt-0.5 truncate pl-6 text-caption text-muted" title={process.command}>
        {process.command}
      </p>
      {process.ports.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5 pl-6">
          {process.ports.map((port) => (
            <button
              key={port}
              type="button"
              title={`Open localhost:${String(port)} in the browser`}
              onClick={() => {
                onOpenPort(port);
              }}
              className="group/port flex h-6 items-center gap-1.5 rounded-md bg-elevated pl-1.5 pr-1 text-caption tabular-nums text-secondary transition-colors hover:bg-active hover:text-primary"
            >
              <Globe className="size-icon-sm shrink-0" aria-hidden="true" />
              <span>localhost:{port}</span>
              <ExternalLink
                className="size-icon-sm shrink-0 opacity-50 transition-opacity group-hover/port:opacity-100"
                aria-hidden="true"
              />
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
