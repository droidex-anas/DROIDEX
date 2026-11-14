// The Components tab beside the board: the entries of the kit catalog the
// target frame pins, each with its thumbnail, searchable. A click or Enter
// opens an entry's detail, where its variants are picked and it is added to
// the layer the line under the search names or tagged in the chat; ⌘Enter adds
// the row the keyboard is on and ⌘L tags it without opening it. The search
// keeps the keyboard and the arrows walk the matches through
// aria-activedescendant, as the frame navigator does; a catalog holds at most
// 128 entries, so every row mounts and each thumbnail loads once it is seen.

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Search } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { Input } from '../../../components/ui/Field';
import { ADD_KEY_LABEL, TAG_KEY_LABEL } from '../boardKeys';
import type { ComponentPin } from '../componentPins';
import { toggleComponentPin } from '../componentTagging';
import type { PropPick } from '../elementEditProtocol';
import type { CatalogListing, DesignSystemRef } from '../protocol';
import { ComponentDetail } from './ComponentDetail';
import { ComponentRow } from './ComponentRow';
import { paletteRows, propPicks, type ChosenProps } from './paletteRows';
import type { PalettePlace } from './useComponentInsert';
import { useKitCatalog, type KitCatalog } from './useKitCatalog';
import { usePaletteKeys } from './usePaletteKeys';

const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16', 'w-24'];
const NO_CHOICES: ChosenProps = {};
const NO_PICKS: PropPick[] = [];

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
  const { chosenOf, pick } = useEntryPicks(kit);
  const [openName, setOpenName] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listScroll = useRef(0);
  const listId = useId();
  const optionId = (index: number) => `${listId}-${String(index)}`;
  const ready = catalog?.state === 'ready' ? catalog : null;
  const matches = ready ? paletteRows(ready.entries, query) : [];
  const opened = matches.find((entry) => entry.name === openName);
  // A kit without the open entry, as after another frame is picked, goes back to its list.
  if (openName !== null && ready && !opened) setOpenName(null);
  const openedChoices = opened ? chosenOf(opened.name) : NO_CHOICES;
  const openedPicks = useMemo(
    () => (opened ? propPicks(opened, openedChoices) : NO_PICKS),
    [opened, openedChoices],
  );
  const picksOf = (entry: CatalogListing) => propPicks(entry, chosenOf(entry.name));
  const tagging = rowTagging(chatId, kit, ready);
  const open = (index: number) => {
    listScroll.current = list.current?.scrollTop ?? 0;
    keys.setActive(index);
    setOpenName(matches[index].name);
  };
  const keys = usePaletteKeys({
    query,
    onQuery: setQuery,
    count: matches.length,
    optionId,
    onOpen: open,
    onAdd: (index) => {
      onAdd(matches[index].name, picksOf(matches[index]));
    },
    onTag: tagging
      ? (index) => {
          toggleComponentPin(
            tagging.chatId,
            tagging.pinOf(matches[index], picksOf(matches[index])),
          );
        }
      : null,
    onLeave,
  });
  // The tab opens on its search, and the list comes back from a detail where it was left.
  useLayoutEffect(() => {
    if (openName !== null) return;
    if (list.current) list.current.scrollTop = listScroll.current;
    field.current?.focus();
  }, [openName]);

  if (opened && kit)
    return (
      <ComponentDetail
        kit={kit}
        entry={opened}
        chosen={openedChoices}
        picks={openedPicks}
        place={place}
        tagging={tagging}
        onPick={(prop, option) => {
          pick(opened.name, prop, option);
        }}
        onAdd={() => {
          onAdd(opened.name, openedPicks);
        }}
        onBack={() => {
          setOpenName(null);
        }}
      />
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ComponentSearch
        fieldRef={field}
        listId={listId}
        activeId={keys.activeIndex < 0 ? undefined : optionId(keys.activeIndex)}
        canTag={tagging !== null}
        query={query}
        hint={place.hint}
        onSearch={keys.search}
        onKeyDown={keys.onKeyDown}
      />
      <CatalogState catalog={catalog} query={query} matches={matches.length} onRetry={retry} />
      {matches.length > 0 && kit && (
        <div
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Components"
          className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
        >
          {matches.map((entry, index) => (
            <ComponentRow
              key={entry.name}
              id={optionId(index)}
              kit={kit}
              entry={entry}
              picks={picksOf(entry)}
              tagging={tagging}
              active={index === keys.activeIndex}
              canAdd={place.canAdd}
              onOpen={() => {
                open(index);
              }}
              onAdd={() => {
                keys.setActive(index);
                onAdd(entry.name, picksOf(entry));
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Each entry's picked variants; they last while the tab stays on one kit version, and nothing keeps them past it. */
function useEntryPicks(kit: DesignSystemRef | undefined) {
  const kitKey = kit && `${kit.id}:${String(kit.version)}`;
  const [picked, setPicked] = useState<{ kitKey?: string; rows: Record<string, ChosenProps> }>({
    rows: {},
  });
  const chosen = picked.kitKey === kitKey ? picked.rows : {};
  return {
    chosenOf: (entry: string): ChosenProps => chosen[entry] ?? NO_CHOICES,
    pick: (entry: string, prop: string, option: string) => {
      setPicked({ kitKey, rows: { ...chosen, [entry]: { ...chosen[entry], [prop]: option } } });
    },
  };
}

/** The search over the list, which keeps the keyboard, and the line under it naming where an add goes. */
function ComponentSearch({
  fieldRef,
  listId,
  activeId,
  canTag,
  query,
  hint,
  onSearch,
  onKeyDown,
}: {
  fieldRef: RefObject<HTMLInputElement | null>;
  listId: string;
  /** The option the keyboard is on, or undefined while nothing matches. */
  activeId: string | undefined;
  canTag: boolean;
  query: string;
  hint: string;
  onSearch: (query: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const hintId = useId();
  const keysHintId = useId();
  return (
    <>
      <div className="shrink-0 px-3">
        <Input
          ref={fieldRef}
          variant="compact"
          type="text"
          role="combobox"
          aria-label="Search components"
          aria-controls={listId}
          aria-expanded
          aria-describedby={`${hintId} ${keysHintId}`}
          aria-activedescendant={activeId}
          aria-keyshortcuts={canTag ? 'Enter Meta+Enter Meta+L' : 'Enter Meta+Enter'}
          placeholder="Search components"
          spellCheck={false}
          leading={<Search className="size-icon-sm" />}
          value={query}
          onChange={(event) => {
            onSearch(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <p
        id={hintId}
        aria-live="polite"
        className="shrink-0 px-5 pb-1.5 pt-2 text-caption text-muted"
      >
        {hint}
      </p>
      <span id={keysHintId} className="sr-only">
        Enter opens the component you are on and {ADD_KEY_LABEL} adds it to the board
        {canTag ? `; ${TAG_KEY_LABEL} tags it in the chat.` : '.'}
      </span>
    </>
  );
}

/** How the rows tag their entries in the chat, or null where they cannot. */
export type RowTagging = ReturnType<typeof rowTagging>;

function rowTagging(
  chatId: string | null,
  kit: DesignSystemRef | undefined,
  catalog: Extract<KitCatalog, { state: 'ready' }> | null,
) {
  if (chatId === null || kit === undefined || catalog === null) return null;
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
          // A thumbnail's height sets each row's, as it sets a real row's.
          <div key={index} aria-hidden className="flex items-center gap-2.5 px-2 py-1.5">
            <span className="skeleton-block h-10 w-16 rounded-sm" />
            <span className={cn('skeleton-block h-3', width)} />
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
