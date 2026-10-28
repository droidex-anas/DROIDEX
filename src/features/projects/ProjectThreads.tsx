import { ArrowLeft, ExternalLink } from '@droidex/icons';
import { Button } from '../../components/ui/Button';
import { ThreadList } from './ThreadList';
import type { ProjectBoardEntry } from './useProjectBoard';

/* One project: what it is, whether its coordination is held, and the threads it
   is running. The threads list is the same one the chat's panel shows, so a
   project reads the same from either side. */

export function ProjectThreads({
  entry,
  now,
  onBack,
  onOpenChat,
  onResume,
  onOpenThread,
}: {
  entry: ProjectBoardEntry;
  now: number;
  onBack: () => void;
  onOpenChat: () => void;
  onResume: () => void;
  onOpenThread: (appSessionId: string) => void;
}) {
  const { project, rows } = entry;
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-6">
      <div className="flex shrink-0 items-center gap-2 py-3">
        <Button
          variant="ghost"
          size="sm"
          icon={ArrowLeft}
          aria-label="Back to projects"
          onClick={onBack}
        />
        <h1 className="min-w-0 flex-1 truncate text-heading">{project.title}</h1>
        <Button variant="ghost" size="sm" icon={ExternalLink} onClick={onOpenChat}>
          Open the chat
        </Button>
      </div>

      {project.paused && (
        <div className="mb-2 flex items-center gap-3 rounded-lg bg-surface px-4 py-3">
          <p className="flex-1 text-body text-secondary">
            {project.uncertain > 0
              ? 'A message may already have reached its thread before DROIDEX stopped. Resuming does not send it again.'
              : 'Paused. Work and queued messages are kept; Resume continues them.'}
          </p>
          <Button variant="secondary" size="sm" onClick={onResume}>
            Resume
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-surface/30">
        <ThreadList
          rows={rows}
          plan={project.plan}
          cwd={project.cwd}
          startedAt={project.startedAt}
          done={project.done}
          // This view carries its own held banner, with the control to resume.
          held={false}
          leadStopped={project.leadStopped === true}
          now={now}
          error={project.error ?? ''}
          onOpenThread={onOpenThread}
        />
      </div>
    </div>
  );
}
