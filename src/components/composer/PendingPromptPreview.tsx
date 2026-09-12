import { Fragment, useState, type ReactNode } from 'react';
import { ImageOff } from 'lucide-react';
import { promptDisplayText } from '../../lib/composePrompt';
import { imageSrc, isImagePath, pathBaseName } from '../../lib/localImage';
import { FileChip } from './FileChip';
import { queuedPromptPreview } from './queuedPromptPreview';

type AttachmentGroup =
  | { type: 'images'; paths: [string, ...string[]] }
  | { type: 'file'; path: string };

function attachmentGroups(paths: readonly string[]): AttachmentGroup[] {
  const groups: AttachmentGroup[] = [];
  for (const path of paths) {
    if (isImagePath(path)) {
      const last = groups.at(-1);
      if (last?.type === 'images') last.paths.push(path);
      else groups.push({ type: 'images', paths: [path] });
    } else {
      groups.push({ type: 'file', path });
    }
  }
  return groups;
}

export function PendingPromptPreview({
  text,
  files,
  skills,
  children,
}: {
  text: string;
  files: readonly string[];
  skills?: readonly string[];
  children?: ReactNode;
}) {
  return (
    <span className="flex-1 min-w-0">
      <span className="line-clamp-2 block break-words text-[12px] text-droid-text-secondary">
        {queuedPromptPreview(promptDisplayText(text, skills)) || '(empty)'}
      </span>
      {attachmentGroups(files).map((group, index) => (
        <Fragment key={String(index)}>
          {group.type === 'images' ? (
            <PendingImages paths={group.paths} />
          ) : (
            <FileChip path={group.path} />
          )}
        </Fragment>
      ))}
      {children}
    </span>
  );
}

// Collapse consecutive images without moving them past intervening files.
function PendingImages({ paths }: { paths: [string, ...string[]] }) {
  const [first] = paths;
  const src = imageSrc(first);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc !== null && failedSrc === src;
  const label = paths.length === 1 ? pathBaseName(first) : `${String(paths.length)} images`;

  return (
    <span
      title={paths.map((path) => pathBaseName(path)).join('\n')}
      className="relative mt-1 inline-block h-6 w-6 align-middle"
    >
      <span className="block h-full w-full overflow-hidden rounded-md border border-droid-border bg-droid-bg/60">
        {src === null || failed ? (
          <span className="flex h-full w-full items-center justify-center text-droid-text-muted">
            <ImageOff className="h-3 w-3" />
          </span>
        ) : (
          <img
            src={src}
            alt={label}
            draggable={false}
            className="h-full w-full object-cover"
            onError={() => {
              setFailedSrc(src);
            }}
          />
        )}
      </span>
      {paths.length > 1 && (
        <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full border border-droid-border bg-droid-elevated px-0.5 text-[11px] font-semibold leading-none text-droid-text">
          {paths.length}
        </span>
      )}
    </span>
  );
}
