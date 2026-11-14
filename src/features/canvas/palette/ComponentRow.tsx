// One entry of the Components tab's list: its thumbnail, its name, and the
// variants its detail picked or else its file. A click opens its detail; on
// hover and on the row the keyboard is on, it offers Tag in chat and Add.

import { Plus } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { Tooltip } from '../../../components/ui/Tooltip';
import { ADD_KEY_LABEL, TAG_KEY_LABEL } from '../boardKeys';
import type { PropPick } from '../elementEditProtocol';
import type { CatalogListing, DesignSystemRef } from '../protocol';
import { TagComponentButton } from '../TagComponentButton';
import type { RowTagging } from './ComponentsPanel';
import { EntryThumbnail } from './EntryThumbnail';

export function ComponentRow({
  id,
  kit,
  entry,
  picks,
  tagging,
  active,
  canAdd,
  onOpen,
  onAdd,
}: {
  id: string;
  kit: DesignSystemRef;
  entry: CatalogListing;
  /** The variants its detail picked, which an add writes. */
  picks: PropPick[];
  tagging: RowTagging;
  active: boolean;
  canAdd: boolean;
  onOpen: () => void;
  onAdd: () => void;
}) {
  const detail =
    picks.length > 0
      ? picks.map(({ value }) => value).join(' · ')
      : entry.module?.split('/').at(-1);
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      title={entry.note ?? undefined}
      className={cn(
        'group flex cursor-pointer select-none items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors duration-150 ease-out',
        active ? 'bg-active' : 'hover:bg-elevated',
      )}
      onPointerDown={(event) => {
        // The search field keeps the keyboard.
        event.preventDefault();
      }}
      onClick={onOpen}
    >
      <EntryThumbnail
        key={`${kit.id}:${String(kit.version)}:${kit.mode}`}
        kit={kit}
        entry={entry.name}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body text-primary">{entry.name}</span>
        {detail !== undefined && (
          <span
            className={cn(
              'truncate text-caption',
              picks.length > 0 ? 'text-secondary' : 'text-muted',
            )}
          >
            {detail}
          </span>
        )}
      </span>
      <span className="-mr-1 flex shrink-0 items-center">
        {tagging && (
          <TagComponentButton
            appSessionId={tagging.chatId}
            pin={tagging.pinOf(entry, picks)}
            shortcut={TAG_KEY_LABEL}
            revealed={active}
            // The search keeps the keyboard; ⌘L tags the row it is on.
            tabIndex={-1}
            className="flex shrink-0"
          />
        )}
        <Tooltip label={`Add to board  ${ADD_KEY_LABEL}`} className="flex shrink-0">
          <Button
            variant="ghost"
            size="sm"
            icon={Plus}
            aria-label={`Add ${entry.name} to the board`}
            disabled={!canAdd}
            // The search keeps the keyboard; ⌘Enter adds the row it is on.
            tabIndex={-1}
            className={cn(
              !active &&
                'opacity-0 focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100',
            )}
            onClick={(event) => {
              event.stopPropagation();
              onAdd();
            }}
          />
        </Tooltip>
      </span>
    </div>
  );
}
