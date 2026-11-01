// The Assets section's images (spec §5, §8): a grid of square tiles that each
// show the image whole, then its name and its type, pixel size and file size.
// A user kit renames, annotates and removes entries; removing one keeps the
// bytes, which older versions may name.

import { useRef, useState } from 'react';
import { ImageOff, MessageSquareText, Pencil } from '@droidex/icons';
import { cn } from '../../../components/ui/cn';
import { DropCue } from '../../tabs/TileDropTarget';
import type { DocumentAsset } from '../designSystemDocumentProtocol';
import type { OwnedAsset } from '../protocol';
import { ActionMenu, type MenuAction } from './ActionMenu';
import { MAX_ASSET_NAME_LENGTH, type DraftChange } from './documentDraft';
import type { DraftMark } from './documentSections';
import { InlineField, type InlineFieldHandle } from './InlineField';
import { NotePopover } from './NotePopover';
import { AddedLabel, UndoRemove, UnsavedMark } from './UnsavedMark';
import { useKitImage, type KitImage } from './useKitImage';

const MAX_NOTE_BYTES = 1024;
const TYPE_NAMES: Record<OwnedAsset['mediaType'], string> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/webp': 'WebP',
};

export function AssetGrid({
  assets,
  marks,
  assetNames,
  actionsFor,
  onChange,
}: {
  assets: DocumentAsset[];
  marks: ReadonlyMap<string, DraftMark>;
  /** Every asset name in the draft, which a renamed asset may not take. */
  assetNames: ReadonlySet<string>;
  /** An entry's move and remove actions. */
  actionsFor: (id: string) => MenuAction[];
  onChange: ((change: DraftChange) => void) | null;
}) {
  return (
    <div className="kit-asset-grid grid gap-x-4 gap-y-6">
      {assets.map((asset) => (
        <AssetTile
          key={asset.id}
          asset={asset}
          mark={marks.get(asset.id)}
          assetNames={assetNames}
          actions={actionsFor(asset.id)}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function AssetTile({
  asset,
  mark,
  assetNames,
  actions,
  onChange,
}: {
  asset: DocumentAsset;
  mark: DraftMark | undefined;
  assetNames: ReadonlySet<string>;
  actions: MenuAction[];
  onChange: ((change: DraftChange) => void) | null;
}) {
  const titleRef = useRef<InlineFieldHandle>(null);
  const tileRef = useRef<HTMLDivElement>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const image = useKitImage(asset.assetId);
  const isRemoved = mark === 'removed';
  const edit = isRemoved ? null : onChange;

  const nameProblem = (name: string) => {
    if (name.length === 0 || name.length > MAX_ASSET_NAME_LENGTH)
      return 'A name is 1 to 120 characters.';
    return assetNames.has(name) ? `Another asset is already called ${name}.` : null;
  };

  return (
    <figure data-item-id={asset.id} className="flex min-w-0 scroll-mt-4 flex-col gap-2">
      <div
        ref={tileRef}
        role="img"
        aria-label={image.status === 'missing' ? `${asset.name}, not in DROIDEX` : asset.name}
        className={cn(
          'relative aspect-square overflow-hidden rounded-lg bg-surface',
          isRemoved && 'opacity-50',
        )}
      >
        <AssetPicture image={image} className="p-3" />
      </div>
      <figcaption className="flex min-w-0 flex-col gap-0.5">
        <span className="relative flex min-h-control-sm min-w-0 items-center gap-1.5">
          <UnsavedMark mark={mark} />
          {edit ? (
            <InlineField
              ref={titleRef}
              value={asset.name}
              label={`Name of the ${asset.name} image`}
              check={nameProblem}
              onCommit={(name) => {
                edit({ kind: 'setItem', item: { ...asset, name } });
              }}
              className="text-body text-primary"
            />
          ) : (
            <span
              className={cn(
                'min-w-0 truncate text-body',
                isRemoved ? 'text-muted line-through' : 'text-primary',
              )}
            >
              {asset.name}
            </span>
          )}
          <span className="flex-1" />
          <AddedLabel mark={mark} />
          {onChange && isRemoved && (
            <UndoRemove label={asset.name} removedKey={asset.id} onChange={onChange} />
          )}
          {edit && (
            <ActionMenu
              label={`${asset.name} actions`}
              actions={[
                { label: 'Rename', icon: Pencil, run: () => titleRef.current?.edit() },
                {
                  label: asset.note === undefined ? 'Add note' : 'Edit note',
                  icon: MessageSquareText,
                  run: () => {
                    setNoteOpen(true);
                  },
                },
                ...actions,
              ]}
            />
          )}
        </span>
        {/* Always one line tall, so a tile does not grow when its image has been read. */}
        <span className="truncate text-caption tabular-nums text-muted">
          {image.status === 'ready' ? imageFacts(image) : '\u00a0'}
        </span>
        {!isRemoved && asset.note !== undefined && (
          <span className="line-clamp-3 whitespace-pre-wrap text-caption text-secondary">
            {asset.note}
          </span>
        )}
      </figcaption>
      {noteOpen && edit && (
        <NotePopover
          anchorRef={tileRef}
          title={`Note · ${asset.name}`}
          note={asset.note}
          maxBytes={MAX_NOTE_BYTES}
          onChange={(note) => {
            edit({ kind: 'setItem', item: { ...asset, note } });
          }}
          onClose={() => {
            setNoteOpen(false);
          }}
        />
      )}
    </figure>
  );
}

/** The image whole inside its frame, faded in once decoded; nothing moves while it loads. */
export function AssetPicture({ image, className }: { image: KitImage; className?: string }) {
  if (image.status === 'loading') return null;
  if (image.status === 'missing')
    return (
      <span className="flex size-full flex-col items-center justify-center gap-1.5 p-3 text-center text-caption text-muted">
        <ImageOff aria-hidden className="size-4" />
        Not in DROIDEX
      </span>
    );
  return (
    <img
      src={image.url}
      alt=""
      draggable={false}
      className={cn('kit-tile-reveal absolute inset-0 size-full object-contain', className)}
    />
  );
}

function imageFacts({
  mediaType,
  width,
  height,
  byteLength,
}: Extract<KitImage, { status: 'ready' }>) {
  return `${TYPE_NAMES[mediaType]} · ${String(width)} × ${String(height)} · ${fileSize(byteLength)}`;
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The drop cue over a section that takes images. */
export function ImageDropCue() {
  return (
    <DropCue className="-inset-3 flex items-center justify-center">
      <span className="rounded-md bg-raised px-2.5 py-1 text-label text-secondary shadow-sm">
        Add to Assets
      </span>
    </DropCue>
  );
}
