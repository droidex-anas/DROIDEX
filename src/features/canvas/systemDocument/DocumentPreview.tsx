// A component preview or demo (spec §5, §7): its title, an optional note and
// the kit's tile of it.

import { useRef, useState } from 'react';
import { MessageSquareText } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import type { DocumentPreview } from '../designSystemDocumentProtocol';
import { ActionMenu, type MenuAction } from './ActionMenu';
import type { DraftChange } from './documentDraft';
import type { DraftMark } from './documentSections';
import { InlineField, type InlineFieldHandle } from './InlineField';
import { KitPreviewTile, type KitPreviewing } from './KitPreviewTile';
import { NotePopover } from './NotePopover';
import { AddedLabel, UndoRemove, UnsavedMark } from './UnsavedMark';

const MAX_TITLE_LENGTH = 120;
const MAX_PREVIEW_NOTE_BYTES = 1024;

export function PreviewItem({
  preview,
  mark,
  previewing,
  previewTitles,
  actions,
  onChange,
}: {
  preview: DocumentPreview;
  mark: DraftMark | undefined;
  previewing: KitPreviewing;
  /** Every preview title in the draft, which a renamed preview may not take. */
  previewTitles: ReadonlySet<string>;
  /** The preview's move and remove actions. */
  actions: MenuAction[];
  onChange: ((change: DraftChange) => void) | null;
}) {
  const titleRef = useRef<InlineFieldHandle>(null);
  const noteRef = useRef<HTMLButtonElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const isRemoved = mark === 'removed';
  const edit = isRemoved ? null : onChange;

  const titleProblem = (title: string) => {
    if (title.length === 0 || title.length > MAX_TITLE_LENGTH)
      return 'A title is 1 to 120 characters.';
    return previewTitles.has(title) ? `Another preview is already called ${title}.` : null;
  };

  return (
    <figure data-item-id={preview.id} className="flex scroll-mt-4 flex-col gap-2">
      <figcaption className="relative flex min-h-control-md items-center gap-2">
        <UnsavedMark mark={mark} />
        {edit ? (
          <InlineField
            ref={titleRef}
            value={preview.title}
            label={`Title of the ${preview.title} preview`}
            check={titleProblem}
            onCommit={(title) => {
              edit({ kind: 'setItem', item: { ...preview, title } });
            }}
            className="kit-heading-font text-body-strong text-primary"
          />
        ) : (
          <span
            className={cn(
              'kit-heading-font truncate text-body-strong',
              isRemoved ? 'text-muted line-through' : 'text-primary',
            )}
          >
            {preview.title}
          </span>
        )}
        <AddedLabel mark={mark} />
        <span className="flex-1" />
        {onChange && isRemoved && (
          <UndoRemove label={preview.title} removedKey={preview.id} onChange={onChange} />
        )}
        {edit && (
          <>
            <Button
              ref={noteRef}
              variant="ghost"
              size="sm"
              icon={MessageSquareText}
              aria-label={
                preview.note === undefined
                  ? `Add a note to ${preview.title}`
                  : `Note of ${preview.title}`
              }
              aria-expanded={noteOpen}
              onClick={() => {
                setNoteOpen((open) => !open);
              }}
            />
            <ActionMenu
              label={`${preview.title} actions`}
              actions={[{ label: 'Rename', run: () => titleRef.current?.edit() }, ...actions]}
            />
          </>
        )}
      </figcaption>
      {!isRemoved && preview.note !== undefined && (
        <p className="whitespace-pre-wrap text-body text-secondary">{preview.note}</p>
      )}
      {!isRemoved && (
        <KitPreviewTile
          previewing={previewing}
          item={preview.id}
          label={`${preview.title} preview`}
          width={preview.width}
          height={preview.height}
          placeholder={
            <span className="flex size-full items-center justify-center text-label text-muted">
              {preview.title}
            </span>
          }
        />
      )}
      {noteOpen && edit && (
        <NotePopover
          anchorRef={noteRef}
          title={`Note · ${preview.title}`}
          note={preview.note}
          maxBytes={MAX_PREVIEW_NOTE_BYTES}
          onChange={(note) => {
            edit({ kind: 'setItem', item: { ...preview, note } });
          }}
          onClose={() => {
            setNoteOpen(false);
          }}
        />
      )}
    </figure>
  );
}
