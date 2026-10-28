// Forgiving search for short pickers such as worktrees and branches. Every query
// word has to appear in one of the texts, in any order, as the start of a word,
// anywhere inside it, or as its letters in order ("usld" finds "usage-ledger").

// Lower is a better match.
const WORD_PREFIX = 0;
const SUBSTRING = 1;
const IN_ORDER = 3;

const WORD_BREAK = /[^\p{L}\p{N}]+/u;

function isInOrder(word: string, text: string): boolean {
  let at = 0;
  for (const letter of word) {
    at = text.indexOf(letter, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
}

function wordRank(word: string, text: string): number | null {
  if (text.split(WORD_BREAK).some((part) => part.startsWith(word))) return WORD_PREFIX;
  if (text.includes(word)) return SUBSTRING;
  if (isInOrder(word, text)) return IN_ORDER;
  return null;
}

/** How well `texts` match `query`, lower is better; null when they do not match. */
function searchRank(query: string, texts: readonly string[]): number | null {
  const words = query.toLowerCase().split(WORD_BREAK).filter(Boolean);
  const haystacks = texts.map((text) => text.toLowerCase());
  let total = 0;
  for (const word of words) {
    let best: number | null = null;
    for (const text of haystacks) {
      const rank = wordRank(word, text);
      if (rank !== null && (best === null || rank < best)) best = rank;
    }
    if (best === null) return null;
    total += best;
  }
  return total;
}

/** Items matching `query`, best first; ties and an empty query keep the given order. */
export function searchItems<T>(
  query: string,
  items: readonly T[],
  texts: (item: T) => readonly string[],
): T[] {
  if (query.trim() === '') return [...items];
  return items
    .map((item) => ({ item, rank: searchRank(query, texts(item)) }))
    .filter((match): match is { item: T; rank: number } => match.rank !== null)
    .sort((a, b) => a.rank - b.rank)
    .map((match) => match.item);
}
