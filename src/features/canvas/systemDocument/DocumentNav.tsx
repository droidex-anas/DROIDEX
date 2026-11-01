// The section nav (spec §5): search, one entry per section with its count and
// a dot when it has unsaved changes, and Add section in user kits. Under about
// 960 px the same nav opens from the header's Sections button instead.

import { useEffect, useRef, useState, type RefObject } from 'react';
import { ListFilter, Plus, Search } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { Menu } from '../../../components/ui/Menu';
import { Popover } from '../../../components/ui/Popover';
import { Tooltip } from '../../../components/ui/Tooltip';
import { cn } from '../../../components/ui/cn';
import { SECTION_TITLES } from './documentDraft';
import type { SectionKind } from './documentSections';

export interface NavEntry {
  id: string;
  title: string;
  count: number;
  isMarked: boolean;
  isRemoved: boolean;
}

export interface DocumentNavProps {
  entries: NavEntry[];
  active: string | null;
  query: string;
  onQueryChange: (query: string) => void;
  onJump: (id: string) => void;
  /** The kinds Add section offers; null for a kit that cannot be edited. */
  addable: SectionKind[] | null;
  onAddSection: (kind: SectionKind) => void;
}

// How far below the column's top a section's heading must pass to be current.
const ACTIVE_OFFSET_PX = 96;

export function DocumentNav({
  entries,
  active,
  query,
  onQueryChange,
  onJump,
  addable,
  onAddSection,
}: DocumentNavProps) {
  return (
    <nav aria-label="Sections" className="flex flex-col gap-2">
      <Input
        variant="compact"
        type="search"
        aria-label="Search this design system"
        placeholder="Search"
        value={query}
        leading={<Search className="size-icon-sm" />}
        className="gap-1.5"
        onChange={(event) => {
          onQueryChange(event.target.value);
        }}
        onKeyDown={(event) => {
          // A search is cleared before Escape leaves the document.
          if (event.key !== 'Escape' || query === '') return;
          event.preventDefault();
          event.stopPropagation();
          onQueryChange('');
        }}
      />
      <ul className="flex flex-col">
        {entries.map((entry) => (
          <li key={entry.id}>
            <button
              type="button"
              aria-current={entry.id === active ? 'location' : undefined}
              onClick={() => {
                onJump(entry.id);
              }}
              className={cn(
                'flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-3 text-left text-body transition-colors',
                entry.id === active
                  ? 'bg-active text-primary'
                  : 'text-secondary hover:bg-elevated hover:text-primary',
              )}
            >
              <span aria-hidden="true" className="flex w-1.5 shrink-0">
                {entry.isMarked && <span className="size-1.5 rounded-full bg-accent" />}
              </span>
              <span className={cn('min-w-0 flex-1 truncate', entry.isRemoved && 'line-through')}>
                {entry.title}
                {entry.isMarked && <span className="sr-only">, unsaved changes</span>}
              </span>
              <span className="shrink-0 text-caption tabular-nums text-muted">{entry.count}</span>
            </button>
          </li>
        ))}
      </ul>
      {entries.length === 0 && query !== '' && (
        <p className="px-3 text-caption text-muted">Nothing matches.</p>
      )}
      {addable && addable.length > 0 && (
        <AddSectionMenu addable={addable} onAddSection={onAddSection} />
      )}
    </nav>
  );
}

function AddSectionMenu({
  addable,
  onAddSection,
}: {
  addable: SectionKind[];
  onAddSection: (kind: SectionKind) => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        ref={anchorRef}
        variant="ghost"
        size="sm"
        icon={Plus}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        Add section
      </Button>
      <Menu
        open={open}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={anchorRef}
        label="Add section"
        width={200}
      >
        {addable.map((kind) => (
          <Menu.Item
            key={kind}
            onSelect={() => {
              onAddSection(kind);
            }}
          >
            {SECTION_TITLES[kind]}
          </Menu.Item>
        ))}
      </Menu>
    </div>
  );
}

/**
 * The nav in a popover, for a canvas area too narrow to keep it beside the
 * document. Unlabelled, its button is the icon alone.
 */
export function SectionsMenu({ labelled, ...props }: DocumentNavProps & { labelled: boolean }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  const toggle = () => {
    setOpen((current) => !current);
  };
  return (
    <>
      {labelled ? (
        <Button
          ref={anchorRef}
          variant="ghost"
          size="sm"
          icon={ListFilter}
          aria-expanded={open}
          onClick={toggle}
        >
          Sections
        </Button>
      ) : (
        <Tooltip label="Sections" placement="bottom">
          <Button
            ref={anchorRef}
            variant="ghost"
            size="sm"
            icon={ListFilter}
            aria-label="Sections"
            aria-expanded={open}
            onClick={toggle}
          />
        </Tooltip>
      )}
      <Popover
        open={open}
        onClose={close}
        anchorRef={anchorRef}
        label="Sections"
        width={280}
        placement="bottom-end"
        className="max-h-96 overflow-y-auto p-1.5"
      >
        <DocumentNav
          {...props}
          onJump={(id) => {
            close();
            props.onJump(id);
          }}
          onAddSection={(kind) => {
            close();
            props.onAddSection(kind);
          }}
        />
      </Popover>
    </>
  );
}

/** The section whose heading last passed the top of the scrolling column. */
export function useActiveSection(
  scrollRef: RefObject<HTMLElement | null>,
  sectionIds: string[],
): string | null {
  const [active, setActive] = useState<string | null>(null);
  const idsKey = sectionIds.join(' ');

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const ids = idsKey === '' ? [] : idsKey.split(' ');
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = scroller.getBoundingClientRect().top + ACTIVE_OFFSET_PX;
      let current = ids.at(0) ?? null;
      for (const id of ids) {
        const heading = scroller.querySelector(`[data-section-id="${id}"]`);
        if (heading && heading.getBoundingClientRect().top <= line) current = id;
      }
      setActive(current);
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, [scrollRef, idsKey]);

  return active;
}
