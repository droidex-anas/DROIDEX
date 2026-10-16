import { FileText } from 'lucide-react';
import { attachmentDisplayName, fileKindInfo, type FileKind } from '../../lib/fileKind';
import { ChipRemoveButton } from './ChipRemoveButton';

// One shared glyph; the tile color and subtitle carry the type. Extra Lucide
// file icons were pulling the initial renderer over its bundle budget.
const TILE_BY_KIND: Record<FileKind, string> = {
  pdf: 'bg-red-500/15 text-red-400',
  document: 'bg-sky-500/15 text-sky-400',
  spreadsheet: 'bg-emerald-500/15 text-emerald-400',
  presentation: 'bg-amber-500/15 text-amber-400',
  text: 'bg-sky-500/15 text-sky-400',
  data: 'bg-violet-500/15 text-violet-400',
  code: 'bg-violet-500/15 text-violet-400',
  image: 'bg-teal-500/15 text-teal-400',
  video: 'bg-rose-500/15 text-rose-400',
  audio: 'bg-orange-500/15 text-orange-400',
  archive: 'bg-muted/10 text-muted',
  file: 'bg-muted/10 text-muted',
};

/**
 * Card-style chip for a file the composer cannot thumbnail: an icon tile
 * colored by type family, the file name, and a type subtitle, with a remove
 * badge in the composer (onRemove) and read-only in the transcript. `name`
 * carries the pasted file's original name; path-only attachments fall back to
 * the basename, with the temp-store prefix stripped for restored chips.
 */
export function FileChip({
  path,
  name,
  onRemove,
  onOpen,
}: {
  path: string;
  name?: string;
  onRemove?: () => void;
  // In the transcript a chip opens its file in Review; the composer's chips
  // only remove.
  onOpen?: () => void;
}) {
  const displayName = name !== undefined && name.length > 0 ? name : attachmentDisplayName(path);
  const info = fileKindInfo(displayName);
  // A span with button semantics rather than a <button>, so the remove badge
  // (itself a button) can still nest inside a chip that also opens.
  return (
    <span
      {...(onOpen
        ? {
            role: 'button',
            tabIndex: 0,
            onClick: onOpen,
            onKeyDown: (event: React.KeyboardEvent) => {
              // The remove badge handles its own keys; they bubble here.
              if (event.target !== event.currentTarget) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onOpen();
            },
          }
        : {})}
      className={`group relative flex max-w-60 items-center gap-2.5 rounded-lg bg-bg/60 py-2 pl-2 pr-2.5 text-left ${
        onOpen ? 'transition-colors hover:bg-bg' : ''
      }`}
      title={onOpen ? `Open ${displayName} in Review` : displayName}
    >
      <span
        className={`flex size-control-md shrink-0 items-center justify-center rounded-md ${TILE_BY_KIND[info.kind]}`}
      >
        <FileText className="size-icon-md" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-label text-primary">{displayName}</span>
        <span className="block text-caption text-muted">{info.label}</span>
      </span>
      {onRemove && <ChipRemoveButton title="Remove file" onRemove={onRemove} />}
    </span>
  );
}
