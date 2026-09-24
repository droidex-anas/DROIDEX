import { useState, type SyntheticEvent } from 'react';
import { ArrowUp, FolderOpen } from '@droidex/icons';
import { pickDirectory } from '../../lib/desktop';
import { chatWorktreeName, prepareChatWorkingDirectory } from '../../lib/chatWorkspace';
import { Pill, StartInBar, type StartInSelection } from '../../components/environment/StartInBar';
import { ThreadSettings } from './ThreadSettings';
import { buildThreadInput, useThreadSelection } from './useThreadSelection';
import type { ThreadInput } from './types';

/* Starting a project asks for one thing: the goal. Everything else (the
   workspace it runs in and the harness, model and autonomy its lead carries)
   sits on one quiet line under the composer, already filled in, because the
   threads the lead spawns inherit those and a person should not have to design
   a team before they can state what they want.

   Where it runs is the composer's own Start in bar, above the goal exactly as
   it sits above the composer: the same repository, worktree and branch menus.
   A project cut into a worktree of its own runs its lead there, and the
   threads it spawns inherit that checkout. */

export function NewProjectForm({
  cwd,
  onSubmit,
  onCancel,
}: {
  cwd: string;
  onSubmit: (input: ThreadInput) => Promise<void>;
  onCancel: () => void;
}) {
  const selection = useThreadSelection();
  const [draft, setDraft] = useState({ title: '', prompt: '' });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [startIn, setStartIn] = useState<StartInSelection>({
    cwd,
    executionMode: 'local',
  });
  const unavailable = selection.catalog.unavailable;
  const blocked = pending || !draft.prompt.trim() || Boolean(unavailable);
  const shownError = error || unavailable;

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (blocked) return;
    setPending(true);
    setError('');
    try {
      const workspace = await startWorkspace();
      if (workspace === undefined) return;
      await onSubmit(buildThreadInput({ ...draft, workspace }, selection.value, selection.catalog));
    } catch (failure) {
      const message = (failure instanceof Error ? failure.message : String(failure)).trim();
      // A runtime error is arbitrary text and often ends without a full stop.
      const sentence = /[.!?]$/.test(message) ? message : `${message}.`;
      setError(`${sentence} Your draft has been kept.`);
    } finally {
      setPending(false);
    }
  }

  /** The folder the lead will work in, cutting its worktree first if asked. */
  async function startWorkspace(): Promise<string | undefined> {
    const result = await prepareChatWorkingDirectory(startIn.cwd, {
      executionMode: startIn.executionMode,
      ...(startIn.branch ? { base: startIn.branch } : {}),
      name: chatWorktreeName(draft.title || draft.prompt, 'project'),
    });
    if (!result.ok) {
      setError(result.message ?? 'Could not create the project worktree.');
      return undefined;
    }
    // A retry after a failed submit reuses this checkout instead of cutting another.
    if (startIn.executionMode === 'worktree') {
      setStartIn({ cwd: result.path, executionMode: 'local' });
    }
    return result.path;
  }

  async function chooseFolder(): Promise<void> {
    try {
      const folder = await pickDirectory();
      if (folder) setStartIn({ cwd: folder, executionMode: 'local' });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="w-full rounded-2xl border border-droid-border bg-droid-surface/40 p-5"
    >
      <h2 className="text-[15px] font-semibold tracking-tight">Start a project</h2>
      <p className="mt-1 text-[12px] leading-5 text-droid-text-muted">
        Say what you want done. The project’s chat plans it, asks you what it needs to know, and
        runs the parts that can go in parallel as threads.
      </p>

      {/* Where it runs, in the composer's own treatment: the bar sits above the
          box and tucks behind it, and holds the folder control whether or not
          one has been chosen yet. */}
      <div className="relative z-0 mx-[6%] -mb-3 mt-4 min-w-0 rounded-t-2xl border border-droid-border bg-droid-surface px-4 pb-4 pt-1.5">
        {startIn.cwd ? (
          <StartInBar value={startIn} onChange={setStartIn} />
        ) : (
          <Pill
            icon={<FolderOpen className="h-3.5 w-3.5" />}
            label="Open folder…"
            title="Project"
            onClick={() => void chooseFolder()}
          />
        )}
      </div>

      <div className="relative z-10 rounded-2xl border border-droid-border bg-droid-bg transition-colors focus-within:border-droid-border-hover">
        <textarea
          value={draft.prompt}
          onChange={(event) => {
            setDraft({ ...draft, prompt: event.target.value });
          }}
          disabled={pending}
          maxLength={8_192}
          required
          rows={4}
          autoFocus
          placeholder="Move us off the legacy payments client before Friday, and draft the release notes."
          className="w-full resize-y bg-transparent px-3.5 pb-3 pt-4 text-[14px] leading-6 outline-none placeholder:text-droid-text-muted"
        />
        <div className="flex items-center gap-2 border-t border-droid-border/60 px-3 py-2">
          <span className="flex min-w-0 flex-1">
            <ThreadSettings
              value={selection.value}
              catalog={selection.catalog}
              statuses={selection.statuses}
              disabled={pending}
              onChange={selection.setValue}
            />
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={onCancel}
            className="rounded-lg px-2.5 py-1 text-[12px] text-droid-text-muted transition-colors hover:bg-droid-elevated hover:text-droid-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            aria-label="Start project"
            disabled={blocked}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-droid-text text-droid-bg transition-opacity hover:opacity-80 disabled:opacity-30"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        </div>
      </div>

      <label className="mt-3 block text-[12px] text-droid-text-muted">
        Name
        <input
          value={draft.title}
          onChange={(event) => {
            setDraft({ ...draft, title: event.target.value });
          }}
          disabled={pending}
          maxLength={120}
          placeholder="Optional, taken from the goal when empty"
          className="mt-1 w-full rounded-xl border border-droid-border bg-droid-bg px-3 py-2 text-[13px] text-droid-text outline-none transition-colors focus-visible:border-droid-border-hover"
        />
      </label>

      {shownError && (
        <p role="alert" className="mt-3 text-[12px] leading-5 text-droid-text-secondary">
          {shownError}
        </p>
      )}
    </form>
  );
}
