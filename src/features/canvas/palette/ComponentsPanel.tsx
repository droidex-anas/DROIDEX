// The Components tab beside the board: the entries of the kit catalog the
// target frame pins, searchable, each added with Enter or a click to the layer
// the line under the search names, with the variants its menu picked, or
// tagged in the chat with them. The
// search keeps the keyboard and the arrows walk the matches through
// aria-activedescendant, as the frame navigator does; a catalog holds at most
// 128 entries, so every row mounts.

import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ChevronDown, Search } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { Input } from '../../../components/ui/Field';
import { Tooltip } from '../../../components/ui/Tooltip';
import { ALT_MODIFIER_LABEL } from '../../../lib/shortcuts';
import { TAG_KEY_LABEL } from '../boardKeys';
import { toggleComponentPin, type ComponentPin } from '../componentPins';
import type { PropPick } from '../elementEditProtocol';
import type { CatalogListing, DesignSystemRef } from '../protocol';
import { TagComponentButton } from '../TagComponentButton';
import { paletteRows, propPicks, type ChosenProps } from './paletteRows';
import type { PalettePlace } from './useComponentInsert';
import { useKitCatalog, type KitCatalog } from './useKitCatalog';
import { usePaletteKeys } from './usePaletteKeys';
import { VariantMenu } from './VariantMenu';

const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16', 'w-24'];

export function ComponentsPanel({
  kit,
  chatId,
  place,
  onAdd,
  onLeave,
}: {
  /** The kit version whose catalog is listed: the target frame's, else the board's first frame's. */
  kit: DesignSystemRef | undefined;
  /** The chat whose next prompt the rows tag entries in; null on a board that is not the chat's own. */
  chatId: string | null;
  place: PalettePlace;
  onAdd: (entry: string, props: PropPick[]) => void;
  /** Escape on an empty search: the keyboard goes back to the board. */
  onLeave: () => void;
}) {
  const { catalog, retry } = useKitCatalog(kit);
  const [query, setQuery] = useState('');
  // Each row's picks last while the tab is open on one kit version; nothing keeps them past it.
  const kitKey = kit && `${kit.id}:${String(kit.version)}`;
  const [picked, setPicked] = useState<{ kitKey?: string; rows: Record<string, ChosenProps> }>({
    rows: {},
  });
  const chosen = picked.kitKey === kitKey ? picked.rows : {};
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const hintId = useId();
  const variantsHintId = useId();
  const tagHintId = useId();
  const optionId = (index: number) => `${listId}-${String(index)}`;
  const matches = catalog?.state === 'ready' ? paletteRows(catalog.entries, query) : [];
  const menuEntry = matches.find((entry) => entry.name === menuFor);
  const picksOf = (entry: CatalogListing) => propPicks(entry, chosen[entry.name] ?? {});
  const tagging = rowTagging(chatId, kit, catalog);
  const keys = usePaletteKeys({
    query,
    onQuery: setQuery,
    count: matches.length,
    optionId,
    onAdd: (index) => {
      onAdd(matches[index].name, picksOf(matches[index]));
    },
    onMenu: (index) => {
      if (matches[index].props.length > 0) setMenuFor(matches[index].name);
    },
    onTag: (index) => {
      if (tagging)
        toggleComponentPin(tagging.chatId, tagging.pinOf(matches[index], picksOf(matches[index])));
    },
    onLeave,
  });
  // The tab opens on its search, from the keyboard or a click.
  useEffect(() => {
    field.current?.focus();
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 px-3">
        <Input
          ref={field}
          variant="compact"
          type="text"
          role="combobox"
          aria-label="Search components"
          aria-controls={listId}
          aria-expanded
          aria-describedby={tagging ? `${hintId} ${tagHintId}` : hintId}
          aria-activedescendant={keys.activeIndex >= 0 ? optionId(keys.activeIndex) : undefined}
          aria-keyshortcuts={tagging ? 'Alt+ArrowDown Meta+L' : 'Alt+ArrowDown'}
          placeholder="Search components"
          spellCheck={false}
          leading={<Search className="size-icon-sm" />}
          value={query}
          onChange={(event) => {
            keys.search(event.target.value);
          }}
          onKeyDown={keys.onKeyDown}
          // A press on the search is not outside the menu it anchors, so focus closes it.
          onFocus={() => {
            setMenuFor(null);
          }}
        />
      </div>
      <p
        id={hintId}
        aria-live="polite"
        className="shrink-0 px-5 pb-1.5 pt-2 text-caption text-muted"
      >
        {place.hint}
      </p>
      {matches.some((entry) => entry.props.length > 0) && (
        <span id={variantsHintId} className="sr-only">
          Alt with Down picks its variants.
        </span>
      )}
      {tagging && (
        <span id={tagHintId} className="sr-only">
          {TAG_KEY_LABEL} tags the component you are on in the chat.
        </span>
      )}
      <CatalogState catalog={catalog} query={query} matches={matches.length} onRetry={retry} />
      {matches.length > 0 && (
        <div
          id={listId}
          role="listbox"
          aria-label="Components"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {matches.map((entry, index) => (
            <CatalogRow
              key={entry.name}
              id={optionId(index)}
              entry={entry}
              picks={picksOf(entry)}
              variantsHintId={variantsHintId}
              tag={
                tagging ? (
                  <TagComponentButton
                    appSessionId={tagging.chatId}
                    pin={tagging.pinOf(entry, picksOf(entry))}
                    shortcut={TAG_KEY_LABEL}
                    revealed={index === keys.activeIndex}
                    // The search keeps the keyboard; ⌘L tags the row it is on.
                    tabIndex={-1}
                    className="flex shrink-0"
                  />
                ) : null
              }
              active={index === keys.activeIndex}
              canAdd={place.canAdd}
              menuOpen={entry === menuEntry}
              triggerRef={trigger}
              onAdd={() => {
                keys.setActive(index);
                setMenuFor(null);
                onAdd(entry.name, picksOf(entry));
              }}
              onMenu={() => {
                keys.setActive(index);
                setMenuFor(entry === menuEntry ? null : entry.name);
              }}
            />
          ))}
        </div>
      )}
      <VariantMenu
        entry={menuEntry}
        chosen={(menuEntry && chosen[menuEntry.name]) ?? {}}
        searchRef={field}
        triggerRef={trigger}
        onClose={() => {
          setMenuFor(null);
        }}
        onPick={(prop, option) => {
          if (!menuEntry) return;
          const { name } = menuEntry;
          setPicked({ kitKey, rows: { ...chosen, [name]: { ...chosen[name], [prop]: option } } });
        }}
      />
    </div>
  );
}

/** How the rows tag their entries in the chat, or null where they cannot. */
function rowTagging(
  chatId: string | null,
  kit: DesignSystemRef | undefined,
  catalog: KitCatalog | null,
) {
  if (chatId === null || kit === undefined || catalog?.state !== 'ready') return null;
  const { kitName } = catalog;
  return {
    chatId,
    pinOf: (entry: CatalogListing, props: PropPick[]): ComponentPin => ({
      kit: { ...kit },
      kitName,
      name: entry.name,
      props,
    }),
  };
}

function CatalogRow({
  id,
  entry,
  picks,
  variantsHintId,
  tag,
  active,
  canAdd,
  menuOpen,
  triggerRef,
  onAdd,
  onMenu,
}: {
  id: string;
  entry: CatalogListing;
  /** The variants the row's menu picked, which the add writes. */
  picks: PropPick[];
  /** What tells a row with variants how the keyboard opens its menu. */
  variantsHintId: string;
  /** The row's Tag in chat toggle, or null where it cannot be tagged. */
  tag: ReactNode;
  active: boolean;
  canAdd: boolean;
  menuOpen: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onAdd: () => void;
  onMenu: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={!canAdd || undefined}
      aria-describedby={entry.props.length > 0 ? variantsHintId : undefined}
      title={entry.note ?? undefined}
      className={cn(
        'group flex select-none items-center gap-2.5 rounded-md px-3 py-1.5 text-body transition-colors duration-150 ease-out',
        active ? 'bg-active' : 'hover:bg-elevated',
        canAdd ? 'cursor-pointer' : 'cursor-default',
      )}
      onPointerDown={(event) => {
        // The search field keeps the keyboard.
        event.preventDefault();
      }}
      onClick={onAdd}
    >
      <span className="min-w-0 truncate text-primary">{entry.name}</span>
      {picks.length > 0 && (
        <span className="shrink-0 text-caption text-secondary">
          {picks.map(({ value }) => value).join(' · ')}
        </span>
      )}
      {entry.module !== null && (
        // The name keeps its width; the file gives way, and its folder repeats on every row.
        <span className="min-w-0 flex-1 truncate text-right text-caption text-muted">
          {entry.module.split('/').at(-1)}
        </span>
      )}
      {(tag !== null || entry.props.length > 0) && (
        <div className="-my-1.5 -mr-2 ml-auto flex shrink-0">
          {tag}
          {entry.props.length > 0 && (
            <Tooltip label={`Variants  ${ALT_MODIFIER_LABEL}↓`} className="flex shrink-0">
              <Button
                ref={menuOpen ? triggerRef : undefined}
                variant="ghost"
                size="sm"
                icon={ChevronDown}
                aria-label={`${entry.name} variants`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                tabIndex={-1}
                onClick={(event) => {
                  event.stopPropagation();
                  onMenu();
                }}
              />
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

/** What stands in for the list while the catalog loads, fails, is empty, or nothing in it matches. */
function CatalogState({
  catalog,
  query,
  matches,
  onRetry,
}: {
  catalog: KitCatalog | null;
  query: string;
  matches: number;
  onRetry: () => void;
}) {
  if (catalog === null) return null;
  if (catalog.state === 'loading')
    return catalog.slow ? (
      <div className="px-2" aria-busy>
        <span role="status" className="sr-only">
          Loading components…
        </span>
        {SKELETON_WIDTHS.map((width, index) => (
          // A line of body text sets each row's height, as a name sets a real row's.
          <div key={index} aria-hidden className="flex items-center px-3 py-1.5 text-body">
            <span className={cn('skeleton-block h-3', width)} />
            <span className="invisible">.</span>
          </div>
        ))}
      </div>
    ) : null;
  if (catalog.state === 'failed')
    return (
      <div role="alert" className="flex flex-col items-start gap-2 px-5 py-2">
        <p className="text-caption text-secondary">
          Couldn’t read this kit’s components. {catalog.message}
        </p>
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  if (catalog.entries.length === 0)
    return (
      <p className="px-5 py-2 text-caption text-muted">
        This kit has no components to add yet. Ask the agent to add examples.
      </p>
    );
  if (matches === 0)
    return (
      <p role="status" className="px-5 py-2 text-caption text-muted">
        Nothing matches “{query.trim()}”.
      </p>
    );
  return null;
}
