import { motion, useReducedMotion } from 'framer-motion';
import { Globe, Search, X } from '@droidex/icons';
import type { BrowserHistoryEntry } from '../../lib/browserHistory';
import { describeLink } from '../../lib/linkPresentation';
import { HoverTooltip } from '../HoverTooltip';
import { LinkBadge } from '../transcript/LinkBadge';
import { normalizeUrl } from './browserViewport';
import type { AddressRow } from './historySuggestions';

// Under the address pill, its width and its left edge, so the rows' icons sit
// under the pill's own. It never takes the focus: the field keeps it and owns
// the keys, and a press here is kept from blurring the field.
export function AddressSuggestions({
  id,
  rows,
  highlighted,
  onHighlight,
  onChoose,
  onRemove,
}: {
  id: string;
  rows: readonly AddressRow[];
  highlighted: number;
  onHighlight: (index: number) => void;
  onChoose: (row: AddressRow) => void;
  onRemove: (url: string) => void;
}) {
  const still = useReducedMotion();
  return (
    <motion.div
      id={id}
      role="listbox"
      aria-label="Address suggestions"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      initial={{ opacity: 0, y: still ? 0 : -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: still ? 0 : -4, transition: { duration: 0.1 } }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-[18px] border border-droid-border/60 bg-droid-raised p-1.5 shadow-droid"
    >
      {rows.map((row, index) => (
        <div
          key={row.kind === 'typed' ? 'typed' : row.entry.url}
          id={`${id}-${String(index)}`}
          role="option"
          aria-selected={index === highlighted}
          onMouseMove={() => {
            if (index !== highlighted) onHighlight(index);
          }}
          onClick={() => {
            onChoose(row);
          }}
          className={`flex h-9 cursor-default items-center gap-2.5 rounded-xl pl-2 pr-1 text-[13px] transition-colors duration-75 motion-reduce:transition-none ${
            index === highlighted ? 'bg-droid-active' : ''
          }`}
        >
          {row.kind === 'typed' ? (
            <TypedRow text={row.text} search={row.search} />
          ) : (
            <HistoryRow
              entry={row.entry}
              highlighted={index === highlighted}
              onRemove={() => {
                onRemove(row.entry.url);
              }}
            />
          )}
        </div>
      ))}
    </motion.div>
  );
}

// In a narrow pane the label gives way before the typed text.
function TypedRow({ text, search }: { text: string; search: boolean }) {
  return (
    <>
      {search ? <Search className={ICON} /> : <SiteIcon url={normalizeUrl(text)} />}
      <span className="flex min-w-0 flex-1 gap-1 pr-2">
        <span className="min-w-0 truncate text-droid-text-muted">
          {search ? 'Search Google for' : 'Go to'}
        </span>
        <span className="max-w-full shrink-0 truncate text-droid-text">{text}</span>
      </span>
    </>
  );
}

// The page's title, then its address as host and path, quieter. In a narrow
// pane the address gives way first. A page without a title reads as its address.
function HistoryRow({
  entry,
  highlighted,
  onRemove,
}: {
  entry: BrowserHistoryEntry;
  highlighted: boolean;
  onRemove: () => void;
}) {
  const address = entry.url.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, '');
  const title = entry.title.trim();
  return (
    <>
      <SiteIcon url={entry.url} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        {title && <span className="max-w-full shrink-0 truncate text-droid-text">{title}</span>}
        <span
          className={`min-w-0 truncate ${title ? 'text-[12px] text-droid-text-muted' : 'text-droid-text'}`}
        >
          {address}
        </span>
      </span>
      <HoverTooltip
        label="Remove from history (⇧⌦)"
        className={`shrink-0 ${highlighted ? '' : 'pointer-events-none opacity-0'}`}
      >
        <button
          type="button"
          tabIndex={-1}
          aria-label="Remove from history"
          onClick={(event) => {
            event.stopPropagation();
            onRemove();
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-droid-text-muted transition-colors duration-150 hover:text-droid-text motion-reduce:transition-none"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </HoverTooltip>
    </>
  );
}

const ICON = 'h-4 w-4 shrink-0 text-droid-text-muted';

function SiteIcon({ url }: { url: string }) {
  const link = describeLink(url);
  if (!link) return <Globe className={ICON} />;
  return <LinkBadge key={link.host} link={link} className="h-4 w-4 shrink-0" />;
}
