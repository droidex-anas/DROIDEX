import {
  diffLineAnchorKey,
  splitCellAnchor,
  unifiedLineAnchors,
  type DiffLine,
  type DiffLineAnchor,
  type DiffLineSide,
  type ParsedDiff,
  type SplitRow,
} from './unifiedDiff';

// Rows carry their React identity with them. Review rows are inserted and
// removed while an editor is open, so positional keys would remount it and
// discard its draft text.
export type DiffRenderRow =
  | { kind: 'header'; id: string; text: string }
  | { kind: 'line'; id: string; line: DiffLine }
  | { kind: 'split'; id: string; left: DiffLine | null; right: DiffLine | null }
  | { kind: 'fold'; id: string; count: number }
  | { kind: 'review'; id: string; side: DiffLineSide; line: number };

export const DIFF_CHUNK_ROWS = 200;

interface PositionedDiffRow {
  position: number;
  row: DiffRenderRow;
}

// A folded run keeps two unchanged lines next to each change and hides at
// least four; smaller folds would cost as much reading as they save.
const FOLD_EDGE_LINES = 2;
const MIN_FOLDED_LINES = 4;
const MIN_FOLD_RUN = FOLD_EDGE_LINES * 2 + MIN_FOLDED_LINES;

function unifiedLineId(line: DiffLine, hunkIndex: number, lineIndex: number): string {
  if (line.type === 'meta') return `meta:${String(hunkIndex)}:${String(lineIndex)}`;
  return `line:${line.type}:${String(line.oldLine ?? 'x')}:${String(line.newLine ?? 'x')}`;
}

function splitLineId(line: DiffLine, rowIndex: number): string {
  if (line.type === 'meta') return `meta:${String(rowIndex)}`;
  return `${line.type}:${String(line.oldLine ?? 'x')}:${String(line.newLine ?? 'x')}`;
}

function splitRowId(row: SplitRow, hunkIndex: number, rowIndex: number): string {
  const left = row.left ? splitLineId(row.left, rowIndex) : 'empty';
  const right = row.right ? splitLineId(row.right, rowIndex) : 'empty';
  return `split:${String(hunkIndex)}:${left}:${right}`;
}

function unifiedLineRow(line: DiffLine, hunkIndex: number, lineIndex: number): DiffRenderRow {
  return { kind: 'line', id: unifiedLineId(line, hunkIndex, lineIndex), line };
}

function splitRenderRow(row: SplitRow, hunkIndex: number, rowIndex: number): DiffRenderRow {
  return {
    kind: 'split',
    id: splitRowId(row, hunkIndex, rowIndex),
    left: row.left,
    right: row.right,
  };
}

function foldId(lines: readonly DiffLine[], hunkIndex: number): string {
  const first = lines[0];
  const last = lines[lines.length - 1];
  return [
    'fold',
    String(hunkIndex),
    String(first.oldLine ?? 'x'),
    String(first.newLine ?? 'x'),
    String(last.oldLine ?? 'x'),
    String(last.newLine ?? 'x'),
    String(lines.length),
  ].join(':');
}

function lineHasAnchor(line: DiffLine, anchors: ReadonlySet<string> | undefined): boolean {
  if (!anchors) return false;
  return unifiedLineAnchors(line).some((anchor) =>
    anchors.has(diffLineAnchorKey(anchor.side, anchor.line)),
  );
}

// Never fold away a line carrying a comment, note, or the open editor: the
// anchored content must stay beside the line it describes.
function canFold(lines: readonly DiffLine[], anchors: ReadonlySet<string> | undefined): boolean {
  return lines.length >= MIN_FOLD_RUN && !lines.some((line) => lineHasAnchor(line, anchors));
}

interface AppendRowsOptions {
  hunkIndex: number;
  positionOffset: number;
  anchors?: ReadonlySet<string>;
  expandedFolds: ReadonlySet<string>;
}

function appendUnifiedLines(
  out: PositionedDiffRow[],
  lines: readonly DiffLine[],
  options: AppendRowsOptions,
) {
  const { hunkIndex, positionOffset, anchors, expandedFolds } = options;
  const position = (lineIndex: number) => positionOffset + 1 + lineIndex;
  const pushLine = (lineIndex: number) => {
    out.push({
      position: position(lineIndex),
      row: unifiedLineRow(lines[lineIndex], hunkIndex, lineIndex),
    });
  };
  let index = 0;
  while (index < lines.length) {
    if (lines[index].type !== 'ctx') {
      pushLine(index);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < lines.length && lines[end].type === 'ctx') end += 1;
    const run = lines.slice(index, end);
    const id = foldId(run, hunkIndex);
    if (!canFold(run, anchors) || expandedFolds.has(id)) {
      for (let lineIndex = index; lineIndex < end; lineIndex += 1) pushLine(lineIndex);
    } else {
      for (let lineIndex = index; lineIndex < index + FOLD_EDGE_LINES; lineIndex += 1) {
        pushLine(lineIndex);
      }
      out.push({
        position: position(index + FOLD_EDGE_LINES),
        row: { kind: 'fold', id, count: run.length - FOLD_EDGE_LINES * 2 },
      });
      for (let lineIndex = end - FOLD_EDGE_LINES; lineIndex < end; lineIndex += 1) {
        pushLine(lineIndex);
      }
    }
    index = end;
  }
}

function isUnchangedSplitRow(row: SplitRow): row is SplitRow & { left: DiffLine; right: DiffLine } {
  return row.left !== null && row.left === row.right && row.left.type === 'ctx';
}

function appendSplitRows(
  out: PositionedDiffRow[],
  rows: readonly SplitRow[],
  options: AppendRowsOptions,
) {
  const { hunkIndex, positionOffset, anchors, expandedFolds } = options;
  const position = (rowIndex: number) => positionOffset + 1 + rowIndex;
  const pushRow = (rowIndex: number) => {
    out.push({
      position: position(rowIndex),
      row: splitRenderRow(rows[rowIndex], hunkIndex, rowIndex),
    });
  };
  let index = 0;
  while (index < rows.length) {
    if (!isUnchangedSplitRow(rows[index])) {
      pushRow(index);
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < rows.length && isUnchangedSplitRow(rows[end])) end += 1;
    const runRows = rows.slice(index, end);
    const run = runRows.map((row) => row.left).filter((line): line is DiffLine => line !== null);
    const id = foldId(run, hunkIndex);
    if (!canFold(run, anchors) || expandedFolds.has(id)) {
      for (let rowIndex = index; rowIndex < end; rowIndex += 1) pushRow(rowIndex);
    } else {
      for (let rowIndex = index; rowIndex < index + FOLD_EDGE_LINES; rowIndex += 1) {
        pushRow(rowIndex);
      }
      out.push({
        position: position(index + FOLD_EDGE_LINES),
        row: { kind: 'fold', id, count: run.length - FOLD_EDGE_LINES * 2 },
      });
      for (let rowIndex = end - FOLD_EDGE_LINES; rowIndex < end; rowIndex += 1) {
        pushRow(rowIndex);
      }
    }
    index = end;
  }
}

function rowAnchors(row: DiffRenderRow): DiffLineAnchor[] {
  if (row.kind === 'line') return unifiedLineAnchors(row.line);
  if (row.kind !== 'split') return [];
  return [splitCellAnchor(row.left, 'old'), splitCellAnchor(row.right, 'new')].filter(
    (anchor): anchor is DiffLineAnchor => anchor !== null,
  );
}

function parseAnchorKey(key: string): DiffLineAnchor | null {
  const separator = key.indexOf(':');
  if (separator < 0) return null;
  const side = key.slice(0, separator);
  if (side !== 'old' && side !== 'new') return null;
  const line = Number.parseInt(key.slice(separator + 1), 10);
  return Number.isFinite(line) ? { side, line } : null;
}

// Chunk membership belongs to positions in the parsed diff, never to visible
// row count. Injected reviews and expanded folds cannot push an editor across
// a chunk boundary and remount it.
export function buildDiffChunks({
  hunks,
  splitRows,
  anchors,
  expandedFolds,
}: {
  hunks: ParsedDiff['hunks'];
  splitRows: SplitRow[][] | null;
  anchors?: ReadonlySet<string>;
  expandedFolds: ReadonlySet<string>;
}): DiffRenderRow[][] {
  const positionedRows: PositionedDiffRow[] = [];
  let positionOffset = 0;
  hunks.forEach((hunk, hunkIndex) => {
    positionedRows.push({
      position: positionOffset,
      row: { kind: 'header', id: `header:${String(hunkIndex)}`, text: hunk.header },
    });
    const rowCount = splitRows ? splitRows[hunkIndex].length : hunk.lines.length;
    const appendOptions = { hunkIndex, positionOffset, anchors, expandedFolds };
    if (splitRows) appendSplitRows(positionedRows, splitRows[hunkIndex], appendOptions);
    else appendUnifiedLines(positionedRows, hunk.lines, appendOptions);
    positionOffset += rowCount + 1;
  });

  const chunkCount = Math.ceil(positionOffset / DIFF_CHUNK_ROWS);
  const chunks = Array.from({ length: chunkCount }, (): DiffRenderRow[] => []);
  const matched = new Set<string>();
  for (const { position, row } of positionedRows) {
    const chunk = chunks[Math.floor(position / DIFF_CHUNK_ROWS)];
    chunk.push(row);
    if (!anchors) continue;
    for (const anchor of rowAnchors(row)) {
      const key = diffLineAnchorKey(anchor.side, anchor.line);
      if (!anchors.has(key) || matched.has(key)) continue;
      matched.add(key);
      chunk.push({ kind: 'review', id: `review:${key}`, side: anchor.side, line: anchor.line });
    }
  }

  if (anchors) {
    const orphans = [...anchors]
      .filter((key) => !matched.has(key))
      .map(parseAnchorKey)
      .filter((anchor): anchor is DiffLineAnchor => anchor !== null)
      .sort((left, right) => left.line - right.line || left.side.localeCompare(right.side));
    if (orphans.length > 0) {
      if (chunks.length === 0) chunks.push([]);
      const last = chunks[chunks.length - 1];
      for (const orphan of orphans) {
        last.push({
          kind: 'review',
          id: `review:${diffLineAnchorKey(orphan.side, orphan.line)}`,
          side: orphan.side,
          line: orphan.line,
        });
      }
    }
  }
  return chunks;
}
