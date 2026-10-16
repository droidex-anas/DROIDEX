import { useState } from 'react';
import { Button } from '../ui/Button';
import { gitCommit } from '../../lib/git';
import { toast } from '../../lib/toast';
import { useBusyAction } from '../../hooks/useBusyAction';

// Inline commit form shown beneath the git actions row.
export function CommitSheet({ cwd, onDone }: { cwd: string; onDone: () => void }) {
  const [message, setMessage] = useState('');
  const [stageAll, setStageAll] = useState(true);
  // run() guards against a second Cmd/Ctrl+Enter (the button is disabled,
  // but the keyboard shortcut isn't) firing a duplicate in-flight commit.
  const { busy, run } = useBusyAction();

  const doCommit = () =>
    run(async () => {
      const text = message.trim();
      if (!text) return;
      try {
        const res = await gitCommit(cwd, { message: text, all: stageAll });
        if (res.ok) {
          toast.success(`Committed ${res.head ?? ''}`.trim());
          setMessage('');
          onDone();
        } else if (res.reason === 'nothing_to_commit') {
          toast.info('Nothing to commit');
        } else {
          toast.error(res.message?.length ? res.message : 'Commit failed');
        }
      } catch {
        // A rejected IPC call (transport failure, no bridge) would otherwise leave
        // the user with only a cleared spinner and no feedback.
        toast.error('Commit failed');
      }
    });

  return (
    <div className="mx-2 mb-1.5 space-y-2 rounded-lg bg-elevated px-2.5 py-2.5">
      <textarea
        autoFocus
        value={message}
        onChange={(e) => {
          setMessage(e.target.value);
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void doCommit();
        }}
        rows={3}
        placeholder="Commit message"
        className="w-full resize-none rounded-md bg-field px-2.5 py-2 text-body text-primary placeholder:text-muted"
      />
      <div className="flex items-center justify-between">
        <label className="flex cursor-pointer items-center gap-1.5 text-label text-secondary">
          <input
            type="checkbox"
            checked={stageAll}
            onChange={(e) => {
              setStageAll(e.target.checked);
            }}
            className="accent-accent"
          />
          Stage all changes
        </label>
        <Button
          variant="primary"
          size="sm"
          loading={busy}
          disabled={!message.trim() || busy}
          onClick={() => void doCommit()}
        >
          Commit
        </Button>
      </div>
    </div>
  );
}
