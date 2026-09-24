import { ArrowLeft, ExternalLink } from '@droidex/icons';
import { workspaceName } from '../../lib/workspaces';
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
  const folder = project.cwd ? workspaceName(project.cwd) : '';
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 pb-6">
      <div className="flex shrink-0 items-center gap-2 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to projects"
          className="rounded-md p-1 text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[18px] font-semibold tracking-tight">
          {project.title}
        </h1>
        <button
          type="button"
          onClick={onOpenChat}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
        >
          Open the chat
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>

      {project.paused && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-droid-border px-4 py-3">
          <p className="flex-1 text-[12px] leading-5 text-droid-text-secondary">
            {project.uncertain > 0
              ? 'A message may already have reached its thread before DROIDEX stopped. Resuming does not send it again.'
              : 'Coordination is held: reports and queued messages wait until this project resumes.'}
          </p>
          <button
            type="button"
            onClick={onResume}
            className="shrink-0 rounded-lg bg-droid-active px-2.5 py-1 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-elevated"
          >
            Resume
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col rounded-2xl border border-droid-border bg-droid-surface/30">
        <ThreadList
          rows={rows}
          plan={project.plan}
          subtitle={[folder, `${String(rows.length)} threads`].filter(Boolean).join(' · ')}
          // This view carries its own held banner, with the control to resume.
          held={false}
          now={now}
          error={project.error ?? ''}
          onOpenThread={onOpenThread}
        />
      </div>
    </div>
  );
}
