import { useState } from 'react';
import type { TranscriptEvent } from '../../types/bridge';
import {
  describeToolCall,
  isListingTool,
  stripAnsi,
  toolMeta,
  type ToolCallLabel,
} from '../../lib/tools';
import type { OpenReviewFileHandler } from '../../lib/reviewFocus';
import { pathFileName } from '../../lib/pathDisplay';
import { namesAFileName } from '../../lib/prosePaths';
import { searchResultFiles } from '../../lib/searchResultFiles';
import { FileTypeIcon } from '../FileTypeIcon';
import { Expand } from './primitives';
import { ToolLine } from './toolLine';

// One row of chips before the rail folds the rest behind a count.
const CHIPS_SHOWN_INITIALLY = 4;

const CHIP_LOOK =
  'inline-flex h-control-sm select-none items-center gap-1.5 rounded-full bg-elevated/50 px-2.5 text-label transition-colors';

// A file a tool call touched, as a pill in its file type's icon and colour.
// Clickable chips keep the 28px hit target; a chip without a handler (the
// settings preview) is the same pill at rest, not a disabled control. A file
// still being read shimmers its name; `entering` gives a chip that lands while
// the turn runs its entrance, so history renders still.
function ToolFileChip({
  path,
  reading,
  entering,
  onOpen,
}: {
  path: string;
  reading: boolean;
  entering: boolean;
  onOpen?: OpenReviewFileHandler;
}) {
  const name = pathFileName(path);
  const body = (
    <>
      <FileTypeIcon filename={name} className="size-icon-sm" />
      <span className={`max-w-40 truncate${reading ? ' shimmer-text' : ''}`}>{name}</span>
    </>
  );
  const look = `${CHIP_LOOK} text-secondary${entering ? ' chip-enter' : ''}`;
  if (!onOpen) {
    return (
      <span title={path} className={look}>
        {body}
      </span>
    );
  }
  return (
    <button
      type="button"
      title={`Open ${path} in Review`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(path);
      }}
      className={`${look} hover:bg-elevated hover:text-primary`}
    >
      {body}
    </button>
  );
}

// The rail's own control ("+3 more", "Show less"), shaped like its chips.
function FoldChip({
  expanded,
  onToggle,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={`${CHIP_LOOK} text-muted hover:bg-elevated hover:text-secondary`}
    >
      {children}
    </button>
  );
}

// The first row of chips, with the rest unfolding below behind the count and
// folding back up behind "Show less".
function ToolFileChipRail({
  paths,
  reading,
  live,
  onOpenReviewFile,
}: {
  paths: string[];
  reading: Set<string>;
  live: boolean;
  onOpenReviewFile?: OpenReviewFileHandler;
}) {
  const [showAll, setShowAll] = useState(false);
  const first = paths.slice(0, CHIPS_SHOWN_INITIALLY);
  const rest = paths.slice(CHIPS_SHOWN_INITIALLY);
  const chip = (path: string) => (
    <ToolFileChip
      key={path}
      path={path}
      reading={reading.has(path)}
      entering={live}
      onOpen={onOpenReviewFile}
    />
  );
  return (
    <>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {first.map(chip)}
        {rest.length > 0 && !showAll && (
          <FoldChip
            expanded={false}
            onToggle={() => {
              setShowAll(true);
            }}
          >
            +{rest.length} more
          </FoldChip>
        )}
      </div>
      <Expand open={showAll && rest.length > 0}>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {rest.map(chip)}
          <FoldChip
            expanded
            onToggle={() => {
              setShowAll(false);
            }}
          >
            Show less
          </FoldChip>
        </div>
      </Expand>
    </>
  );
}

// A tool call with the result it correlated to, when one has landed.
export interface ExplorationCall {
  event: TranscriptEvent;
  result?: TranscriptEvent;
}

function describeFilesCall({ event, result }: ExplorationCall) {
  const { cat } = toolMeta(event.toolName, event.toolArgs);
  const call = describeToolCall(event.toolName, event.toolArgs);
  const listing = isListingTool(event.toolName);
  const targetFile =
    call.objectKind === 'path' && !listing && namesAFileName(pathFileName(call.object))
      ? call.object
      : null;
  // A failed call names no files; an interrupted one may already name some.
  // A read's output is the file's contents, not a result list, so only
  // searches and listings parse files out of their output.
  const parsed =
    result?.isError || !result?.text || (cat === 'read' && !listing)
      ? []
      : searchResultFiles(result.text);
  return { cat, call, targetFile, parsed, result };
}

type FilesCallMeta = ReturnType<typeof describeFilesCall>;

// A burst speaks with its shared vocabulary: a pure read run is "Read N
// files", a pure search run keeps its patterns, a mix is "Explored". The count
// names unique files (the chips), never calls, so the row can never claim more
// files than it shows.
function burstLabel(metas: FilesCallMeta[], fileCount: number): ToolCallLabel {
  const files = `${String(fileCount)} ${fileCount === 1 ? 'file' : 'files'}`;
  let verb = 'Explored';
  let liveVerb = 'Exploring';
  let target = fileCount > 0 ? files : '';
  if (metas.every((m) => m.cat === 'read')) {
    verb = 'Read';
    liveVerb = 'Reading';
  } else if (metas.every((m) => m.cat === 'search')) {
    verb = 'Searched';
    liveVerb = 'Searching';
    target = [...new Set(metas.map((m) => m.call.object).filter(Boolean))].join(', ');
  }
  return { verb, liveVerb, object: target, objectKind: target ? 'text' : 'none' };
}

/* ── Calls that name files (codebase searches, reads, directory listings) as
   one row with the files as clickable chips underneath instead of a raw output
   dump. A single call keeps its own sentence, folding a read's file into its
   chip so it appears once (a listing keeps its directory on the row). A burst
   of consecutive calls is one exploration gesture and pools its files into one
   rail. The row is visual-only: the chips open the files in Review, a failure
   surfaces inline, and while the turn runs the verb shimmers, each file chips
   in as its call starts and shimmers until its read lands. One component owns
   both shapes so a row growing from one call into a burst never remounts. ── */
export function ToolFilesCard({
  calls,
  live = false,
  onOpenReviewFile,
}: {
  calls: ExplorationCall[];
  live?: boolean;
  onOpenReviewFile?: OpenReviewFileHandler;
}) {
  const metas = calls.map(describeFilesCall);
  const files = [
    ...new Set([
      ...metas.flatMap((m) => (m.targetFile ? [m.targetFile] : [])),
      ...metas.flatMap((m) => m.parsed),
    ]),
  ];
  const reading = new Set(
    metas.flatMap((m) => (live && !m.result && m.targetFile ? [m.targetFile] : [])),
  );
  const single = metas.length === 1 ? metas[0] : null;
  const failed = metas.filter((m) => m.result?.isError);
  const errorOutput = failed
    .map((m) => stripAnsi(m.result?.text ?? '').trimEnd())
    .filter(Boolean)
    .join('\n\n');
  return (
    <ToolLine
      event={calls[0].event}
      label={single ? undefined : burstLabel(metas, files.length)}
      output={errorOutput}
      images={[...new Set(metas.flatMap((m) => m.result?.images ?? []))]}
      error={failed.length > 0}
      interrupted={metas.some((m) => m.result?.interrupted === true)}
      running={live && metas.some((m) => !m.result)}
      expandable={false}
      onOpenReviewFile={onOpenReviewFile}
      hideTarget={single?.targetFile != null}
      summaryRow={
        <Expand open={files.length > 0}>
          <ToolFileChipRail
            paths={files}
            reading={reading}
            live={live}
            onOpenReviewFile={onOpenReviewFile}
          />
        </Expand>
      }
    />
  );
}
