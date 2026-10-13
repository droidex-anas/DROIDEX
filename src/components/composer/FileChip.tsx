import { FileText, X } from 'lucide-react';
import { attachmentDisplayName, fileKindInfo, type FileKind } from '../../lib/fileKind';

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
      className={`group relative flex max-w-60 items-center gap-2.5 rounded-xl border border-divider bg-bg/60 py-2 pl-2 pr-2.5 text-left ${
        onOpen
          ? 'transition-colors hover:border-divider-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60'
          : ''
      }`}
      title={onOpen ? `Open ${displayName} in Review` : displayName}
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${TILE_BY_KIND[info.kind]}`}
      >
        <FileText className="h-4 w-4" />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[12px] font-medium text-primary">{displayName}</span>
        <span className="block text-[11px] text-muted">{info.label}</span>
      </span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-divider bg-raised text-muted shadow-[0_1px_2px_0_rgb(0_0_0/0.05)] transition-colors after:absolute after:-inset-0.5 after:content-[''] hover:border-divider-strong hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
          title="Remove file"
        >
          <X className="h-2.5 w-2.5" strokeWidth={3} />
        </button>
      )}
    </span>
  );
}
