// The section nav (spec §5): search, one entry per section with its icon, its
// count and a dot when it has unsaved changes, a "+ Section" row that adds a
// notes section in user kits, and the kit's files. Under about 720 px the same
// nav opens from the header's Sections button instead.

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import {
  BookOpen,
  Box,
  Circle,
  Copy,
  Hash,
  ImageIcon,
  Layers,
  MoveHorizontal,
  Palette,
  Scan,
  Type,
  Wind,
  type LucideIcon,
} from 'lucide-react';
import { ListFilter, Plus, Search } from '@droidex/icons';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Field';
import { Popover } from '../../../components/ui/Popover';
import { Tooltip } from '../../../components/ui/Tooltip';
import { cn } from '../../../components/ui/cn';
import { pushEscapeLayer } from '../../../components/ui/escapeStack';
import type { DocumentSection } from '../designSystemDocumentProtocol';
import { FilesRow } from './FilesRow';
import type { KitFile } from './kitFiles';

export interface NavEntry {
  id: string;
  kind: DocumentSection['kind'];
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
  /** Adds a notes section with the typed title; null for a kit that cannot be edited. */
  onAddSection: ((title: string) => void) | null;
  files: KitFile[];
  onOpenFile: (file: KitFile) => void;
}

// How far below the column's top a section's heading must pass to be current.
const ACTIVE_OFFSET_PX = 96;

const KIND_ICON: Partial<Record<DocumentSection['kind'], LucideIcon>> = {
  colors: Palette,
  typography: Type,
  spacing: MoveHorizontal,
  radius: Scan,
  shadows: Copy,
  motion: Wind,
  components: Box,
  assets: ImageIcon,
};

// Notes and other-token sections say what they hold only in their title.
const TITLE_ICON = new Map<string, LucideIcon>([
  ['overview', BookOpen],
  ['size', Circle],
  ['sizes', Circle],
  ['zindex', Layers],
]);

function sectionIcon(entry: NavEntry): LucideIcon {
  const titleKey = entry.title.toLowerCase().replace(/[^a-z]/g, '');
  return KIND_ICON[entry.kind] ?? TITLE_ICON.get(titleKey) ?? Hash;
}

export function DocumentNav({
  entries,
  active,
  query,
  onQueryChange,
  onJump,
  onAddSection,
  files,
  onOpenFile,
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
        {entries.map((entry) => {
          const Icon = sectionIcon(entry);
          return (
            <li key={entry.id}>
              <button
                type="button"
                aria-current={entry.id === active ? 'location' : undefined}
                onClick={() => {
                  onJump(entry.id);
                }}
                className={cn(
                  'flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-left text-body transition-colors',
                  entry.id === active
                    ? 'bg-active text-primary'
                    : 'text-secondary hover:bg-elevated hover:text-primary',
                )}
              >
                {/* Drawn at the stroke of the @droidex/icons glyphs around them. */}
                <Icon aria-hidden="true" strokeWidth={1.5} className="size-icon-sm shrink-0" />
                <span className={cn('min-w-0 flex-1 truncate', entry.isRemoved && 'line-through')}>
                  {entry.title}
                  {entry.isMarked && <span className="sr-only">, unsaved changes</span>}
                </span>
                {entry.isMarked && (
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent" />
                )}
                <span className="shrink-0 text-caption tabular-nums text-muted">{entry.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {entries.length === 0 && query !== '' && (
        <p className="px-3 text-caption text-muted">Nothing matches.</p>
      )}
      {onAddSection && <AddSectionRow onAddSection={onAddSection} />}
      <div className="pt-2">
        <FilesRow files={files} onOpen={onOpenFile} />
      </div>
    </nav>
  );
}

const MAX_TITLE_LENGTH = 120;

// The nav's last row in a user kit: "+ Section" becomes a title field, and
// Enter adds a notes section with that title (spec §5).
function AddSectionRow({ onAddSection }: { onAddSection: (title: string) => void }) {
  // The typed title while the field is open, null while "+ Section" shows.
  const [title, setTitle] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const isOpen = title !== null;

  // Closing the field hands focus back to the "+ Section" it replaced.
  const close = () => {
    flushSync(() => {
      setTitle(null);
    });
    triggerRef.current?.focus();
  };
  const closeOnEscape = useEffectEvent(close);

  // Escape closes the field before it reaches the popover or the document.
  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    return pushEscapeLayer(() => {
      closeOnEscape();
    });
  }, [isOpen]);

  if (title === null)
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setTitle('');
        }}
        className="flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-3 text-body text-muted transition-colors hover:bg-elevated hover:text-primary"
      >
        <Plus aria-hidden="true" className="size-icon-sm shrink-0" />
        Section
      </button>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = title.trim();
        close();
        if (trimmed.length > 0) onAddSection(trimmed);
      }}
    >
      <Input
        ref={inputRef}
        variant="compact"
        aria-label="New section title"
        placeholder="Section title"
        value={title}
        maxLength={MAX_TITLE_LENGTH}
        spellCheck={false}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
      />
    </form>
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
  const addSection = props.onAddSection;
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
          onOpenFile={(file) => {
            close();
            props.onOpenFile(file);
          }}
          onAddSection={
            addSection === null
              ? null
              : (title) => {
                  close();
                  addSection(title);
                }
          }
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
