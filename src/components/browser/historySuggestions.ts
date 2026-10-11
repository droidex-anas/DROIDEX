import { useEffect, useState } from 'react';
import { getBrowserHistory, type BrowserHistoryEntry } from '../../lib/browserHistory';
import { isDesktop } from '../../lib/desktop';
import { normalizeUrl, SEARCH_URL } from './browserViewport';

const HISTORY_LIMIT = 6;
const QUERY_DELAY_MS = 50;

export type AddressRow =
  | { kind: 'typed'; text: string; search: boolean }
  | { kind: 'history'; entry: BrowserHistoryEntry };

/** Visited pages matching `query`, or none while `query` is null (the dropdown is closed). */
export function useHistorySuggestions(query: string | null) {
  const [entries, setEntries] = useState<BrowserHistoryEntry[]>([]);
  // Closing forgets the rows, so the next query does not open on old ones. While
  // open, a query's rows stay up until the next query's arrive, so they do not
  // flicker on every keystroke.
  if (query === null && entries.length > 0) setEntries([]);

  useEffect(() => {
    if (query === null || !isDesktop()) return;
    let current = true;
    const timer = window.setTimeout(() => {
      getBrowserHistory()
        .suggest(query, HISTORY_LIMIT)
        .then(
          (found) => {
            if (current) setEntries(found);
          },
          (error: unknown) => {
            console.error('Could not read browser history suggestions:', error);
          },
        );
    }, QUERY_DELAY_MS);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  const remove = (url: string) => {
    setEntries((shown) => shown.filter((entry) => entry.url !== url));
    getBrowserHistory()
      .remove(url)
      .catch((error: unknown) => {
        console.error('Could not remove the page from browser history:', error);
      });
  };

  return { entries, remove };
}

// What the omnibox does with the text comes first, so Enter keeps doing it;
// a visited page that is that same address is not listed twice.
export function addressRows(value: string, entries: readonly BrowserHistoryEntry[]): AddressRow[] {
  const target = normalizeUrl(value);
  const targetHref = URL.canParse(target) ? new URL(target).href : target;
  return [
    { kind: 'typed', text: value.trim(), search: target.startsWith(SEARCH_URL) },
    ...entries
      .filter((entry) => entry.url !== targetHref)
      .map((entry): AddressRow => ({ kind: 'history', entry })),
  ];
}
