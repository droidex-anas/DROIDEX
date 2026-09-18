import { useState, type SyntheticEvent } from 'react';
import { ArrowUp, FolderOpen } from '@droidex/icons';
import { pickDirectory } from '../../lib/desktop';
import { workspaceName } from '../../lib/workspaces';
import { ThreadSettings } from './ThreadSettings';
import { buildThreadInput, useThreadSelection } from './useThreadSelection';
import type { ThreadInput } from './types';

/* Starting a project asks for one thing: the goal. Everything else — the
   workspace it runs in and the harness, model and autonomy its lead carries —
   sits on one quiet line under the composer, already filled in, because the
   threads the lead spawns inherit those and a person should not have to design
   a team before they can state what they want. */

export function NewProjectForm({
  cwd,
  onSubmit,
  onCancel,
}: {
  cwd: string;
  onSubmit: (input: ThreadInput) => Promise<void>;
  onCancel: () => void;
}) {
  const selection = useThreadSelection(undefined);
  const [draft, setDraft] = useState({ title: '', prompt: '', workspace: cwd });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const unavailable = selection.catalog.unavailable;
  const blocked = pending || !draft.prompt.trim() || Boolean(unavailable);
  const shownError = error || unavailable;

  async function submit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (blocked) return;
    setPending(true);
    setError('');
    try {
      await onSubmit(buildThreadInput(draft, selection.value, selection.catalog));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setPending(false);
    }
  }

  async function chooseFolder(): Promise<void> {
    try {
      const workspace = await pickDirectory();
      if (workspace) setDraft((current) => ({ ...current, workspace }));
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

      <div className="mt-4 rounded-xl border border-droid-border bg-droid-bg transition-colors focus-within:border-droid-border-hover">
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
          className="w-full resize-y bg-transparent px-3.5 py-3 text-[14px] leading-6 outline-none placeholder:text-droid-text-muted"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-droid-border/60 px-3 py-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => void chooseFolder()}
            title={draft.workspace || 'Choose a workspace folder'}
            className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-elevated"
          >
            <FolderOpen className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">
              {draft.workspace ? workspaceName(draft.workspace) : 'No folder'}
            </span>
          </button>
          <ThreadSettings
            value={selection.value}
            catalog={selection.catalog}
            disabled={pending}
            onChange={selection.setValue}
          />
          <span className="flex-1" />
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
          placeholder="Optional — taken from the goal when empty"
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
