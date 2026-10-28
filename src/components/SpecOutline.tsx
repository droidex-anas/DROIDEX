import { useRef, useEffect, useMemo } from 'react';
import { Search, X } from '@droidex/icons';
import { isTranscriptFindShortcut } from '../lib/keyboardShortcuts';
import { Button } from './ui/Button';
import { Input } from './ui/Field';
import { Row } from './ui/Row';

export interface OutlineHeading {
  level: number;
  text: string;
  id: string;
  content: string;
}

// extractOutline only reads h1-h3. The wrapper indents deeper headings as
// layout: level 1 sits at the content edge, each level a step further in.
const INDENT_BY_LEVEL: Record<number, string> = { 1: '', 2: 'pl-3', 3: 'pl-6' };

function extractOutline(markdown: string): OutlineHeading[] {
  const headings: OutlineHeading[] = [];
  const lines = markdown.split('\n');
  let currentHeading: { level: number; text: string; id: string; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = /^(#{1,3})\s+(.+)$/.exec(line);
    if (match) {
      if (currentHeading) {
        headings.push({
          level: currentHeading.level,
          text: currentHeading.text,
          id: currentHeading.id,
          content: currentHeading.lines.join('\n').trim().slice(0, 400),
        });
      }
      const text = match[2].trim();
      const id = text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
      currentHeading = { level: match[1].length, text, id, lines: [] };
    } else if (currentHeading) {
      currentHeading.lines.push(line);
    }
  }
  if (currentHeading) {
    headings.push({
      level: currentHeading.level,
      text: currentHeading.text,
      id: currentHeading.id,
      content: currentHeading.lines.join('\n').trim().slice(0, 400),
    });
  }
  return headings;
}

export function useSpecOutline(markdown: string) {
  return useMemo(() => extractOutline(markdown), [markdown]);
}

export function SpecOutline({
  headings,
  activeId,
  onSelect,
  searchQuery,
  onSearchChange,
}: {
  headings: OutlineHeading[];
  activeId: string | null;
  onSelect: (id: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
}) {
  const searchRef = useRef<HTMLInputElement>(null);

  const q = searchQuery.trim().toLowerCase();
  const filtered = q ? headings.filter((h) => h.text.toLowerCase().includes(q)) : headings;

  // Cmd/Ctrl+F focuses the outline search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTranscriptFindShortcut(e)) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const highlight = (text: string) => {
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q);
    if (idx < 0) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-transparent text-accent font-medium">
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  return (
    <aside data-spec-outline className="flex w-60 shrink-0 select-none flex-col bg-bg">
      {/* Search */}
      <div className="shrink-0 px-2 py-2.5">
        <div className="relative">
          <Input
            ref={searchRef}
            value={searchQuery}
            onChange={(e) => {
              onSearchChange(e.target.value);
            }}
            placeholder="Find in outline…"
            aria-label="Find in outline"
            spellCheck={false}
            className="pl-9 pr-9"
          />
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-icon-sm -translate-y-1/2 text-muted"
          />
          {searchQuery && (
            // The wrapper carries the position: Button always applies
            // `relative` itself, so the button cannot position itself.
            <span className="absolute right-1 top-1/2 -translate-y-1/2">
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                aria-label="Clear search"
                title="Clear"
                onClick={() => {
                  onSearchChange('');
                }}
              />
            </span>
          )}
        </div>
      </div>

      {/* Heading list */}
      <nav className="flex-1 overflow-y-auto px-2 py-2">
        {filtered.length === 0 ? (
          <div className="px-2 py-6 text-center text-caption text-muted">
            {q ? 'No matching sections' : 'No sections'}
          </div>
        ) : (
          filtered.map((h) => (
            <div key={h.id} className={INDENT_BY_LEVEL[h.level]}>
              <Row
                label={highlight(h.text)}
                active={activeId === h.id}
                onClick={() => {
                  onSelect(h.id);
                }}
              />
            </div>
          ))
        )}
      </nav>

      {/* Footer count */}
      <div className="flex h-8 shrink-0 items-center justify-center">
        <span className="text-caption tabular-nums text-muted">
          {q ? `${filtered.length}/${headings.length}` : `${headings.length} sections`}
        </span>
      </div>
    </aside>
  );
}
