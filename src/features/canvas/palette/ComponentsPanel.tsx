// The Components tab beside the board: the entries of the kit catalog the
// target frame pins, searchable, each added with Enter or a click to the layer
// the line under the search names. The search keeps the keyboard and the
// arrows walk the matches through aria-activedescendant, as the frame
// navigator does; a catalog holds at most 128 entries, so every row mounts.

import { useEffect, useId, useRef, useState } from 'react';
import { Search } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { cn } from '../../../components/ui/cn';
import { Input } from '../../../components/ui/Field';
import type { CatalogListing, DesignSystemVersionRef } from '../protocol';
import { paletteRows } from './paletteRows';
import type { PalettePlace } from './useComponentInsert';
import { useKitCatalog, type KitCatalog } from './useKitCatalog';
import { usePaletteKeys } from './usePaletteKeys';

const SKELETON_WIDTHS = ['w-24', 'w-32', 'w-20', 'w-28', 'w-16', 'w-24'];

export function ComponentsPanel({
  kit,
  place,
  onAdd,
  onLeave,
}: {
  /** The kit version whose catalog is listed: the target frame's, else the board's first frame's. */
  kit: DesignSystemVersionRef | undefined;
  place: PalettePlace;
  onAdd: (entry: string) => void;
  /** Escape on an empty search: the keyboard goes back to the board. */
  onLeave: () => void;
}) {
  const { catalog, retry } = useKitCatalog(kit);
  const [query, setQuery] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const listId = useId();
  const hintId = useId();
  const optionId = (index: number) => `${listId}-${String(index)}`;
  const matches = catalog?.state === 'ready' ? paletteRows(catalog.entries, query) : [];
  const keys = usePaletteKeys({
    query,
    onQuery: setQuery,
    count: matches.length,
    optionId,
    onAdd: (index) => {
      onAdd(matches[index].name);
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
          aria-describedby={hintId}
          aria-activedescendant={keys.activeIndex >= 0 ? optionId(keys.activeIndex) : undefined}
          placeholder="Search components"
          spellCheck={false}
          leading={<Search className="size-icon-sm" />}
          value={query}
          onChange={(event) => {
            keys.search(event.target.value);
          }}
          onKeyDown={keys.onKeyDown}
        />
      </div>
      <p
        id={hintId}
        aria-live="polite"
        className="shrink-0 px-5 pb-1.5 pt-2 text-caption text-muted"
      >
        {place.hint}
      </p>
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
              active={index === keys.activeIndex}
              canAdd={place.canAdd}
              onAdd={() => {
                keys.setActive(index);
                onAdd(entry.name);
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CatalogRow({
  id,
  entry,
  active,
  canAdd,
  onAdd,
}: {
  id: string;
  entry: CatalogListing;
  active: boolean;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={!canAdd || undefined}
      title={entry.note ?? undefined}
      className={cn(
        'flex select-none items-center gap-2.5 rounded-md px-3 py-1.5 text-body transition-colors duration-150 ease-out',
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
      {entry.module !== null && (
        // The name keeps its width; the file gives way, and its folder repeats on every row.
        <span className="min-w-0 flex-1 truncate text-right text-caption text-muted">
          {entry.module.split('/').at(-1)}
        </span>
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
