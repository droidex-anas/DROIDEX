import { Spinner, X } from '@droidex/icons';
import type { FileChange } from '../../lib/diff';
import { displayPath } from '../../lib/pathDisplay';
import { DiffLines } from '../DiffView';
import { FileTypeIcon } from '../FileTypeIcon';
import { Markdown } from '../Markdown';
import { MARKDOWN_EXTENSIONS } from '../files/FilePreviewPane';

// A focus request that no git scope could satisfy still lands somewhere
// useful: the change captured in the transcript, or the file on disk.
export type DetachedFocus =
  | { kind: 'change'; change: FileChange }
  | { kind: 'preview'; path: string; content: string | null };

const PREVIEW_CHAR_LIMIT = 200_000;

function DetachedFilePreview({ path, content }: { path: string; content: string }) {
  const ext = path.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? '';
  const truncated = content.length > PREVIEW_CHAR_LIMIT;
  const text = truncated ? content.slice(0, PREVIEW_CHAR_LIMIT) : content;
  return (
    <div className="px-4 py-3">
      {MARKDOWN_EXTENSIONS.has(ext) ? (
        <Markdown allowGeneratedContent={false}>{text}</Markdown>
      ) : (
        <pre className="whitespace-pre-wrap break-words font-mono text-code text-secondary">
          {text}
        </pre>
      )}
      {truncated && (
        <div className="mt-2 text-caption text-muted">
          Preview truncated at {Math.round(PREVIEW_CHAR_LIMIT / 1000)}k characters
        </div>
      )}
    </div>
  );
}

export function DetachedFocusPane({
  focus,
  cwd,
  onClose,
}: {
  focus: DetachedFocus;
  cwd: string;
  onClose: () => void;
}) {
  const path = focus.kind === 'change' ? focus.change.path : focus.path;
  const label = displayPath(path, cwd);
  const name = label.split(/[\\/]/).pop() ?? label;
  const note =
    focus.kind === 'change'
      ? 'Change captured during the turn'
      : 'No diff in this scope, showing the file on disk';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 bg-surface px-3">
        <FileTypeIcon filename={path} className="size-icon-sm shrink-0" />
        <span className="shrink-0 text-label text-secondary">{name}</span>
        <span className="min-w-0 flex-1 truncate text-caption text-muted">{note}</span>
        {focus.kind === 'change' && (
          <span className="shrink-0 text-caption tabular-nums">
            <span style={{ color: 'var(--diff-add-fg)' }}>+{focus.change.added}</span>{' '}
            <span style={{ color: 'var(--diff-del-fg)' }}>−{focus.change.removed}</span>
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          title="Close"
          aria-label="Close"
          className="shrink-0 rounded-sm p-1 text-muted transition-colors hover:bg-elevated hover:text-primary"
        >
          <X className="size-icon-sm" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {focus.kind === 'change' ? (
          <div className="py-1">
            <DiffLines ops={focus.change.ops} />
          </div>
        ) : focus.content === null ? (
          <div className="flex h-full items-center justify-center gap-2 text-body text-muted">
            <Spinner className="size-icon-md motion-safe:animate-spin-slow" /> Loading…
          </div>
        ) : (
          <DetachedFilePreview path={focus.path} content={focus.content} />
        )}
      </div>
    </div>
  );
}
