import { useState } from 'react';
import type { TranscriptEvent } from '../../types/bridge';
import { describeToolCall, safeJson, stripAnsi, type ToolCallLabel } from '../../lib/tools';
import type { OpenReviewFileHandler } from '../../lib/reviewFocus';
import { compactPath } from '../../lib/pathDisplay';
import { Caret, ErrorTag, Expand, InterruptedTag, linkify } from './primitives';
import { ToolCallCard } from './commandCard';
import { LinkBadge } from './LinkBadge';
import { TranscriptImage } from '../media/TranscriptImage';
import { useToolSourceMark } from './toolSourceMark';

// The row's object: a path opens in Review when the transcript can, anything
// else is plain text. Paths compact to their tail with the directory dimmed so
// the file name carries the line.
function ToolTarget({
  call,
  onOpenReviewFile,
}: {
  call: ToolCallLabel;
  onOpenReviewFile?: OpenReviewFileHandler;
}) {
  if (call.objectKind === 'none') return null;
  if (call.objectKind !== 'path') {
    return <span className="min-w-0 truncate text-muted">{call.object}</span>;
  }
  const shown = compactPath(call.object);
  const slash = shown.lastIndexOf('/');
  const dir = slash >= 0 ? shown.slice(0, slash + 1) : '';
  const name = slash >= 0 ? shown.slice(slash + 1) : shown;
  const parts = (
    <>
      {dir && <span className="text-muted/50">{dir}</span>}
      <span className="text-muted transition-colors group-hover/path:text-primary">{name}</span>
    </>
  );
  if (!onOpenReviewFile) return <span className="min-w-0 truncate">{parts}</span>;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onOpenReviewFile(call.object);
      }}
      title={`Open ${call.object} in Review`}
      className="group/path min-w-0 truncate text-left"
    >
      {parts}
    </button>
  );
}

// One tool call as a sentence: "Read src/app.tsx", "Searched src", or a
// readable tool name. In flight the verb shimmers in its live form; a body
// (captured output or the error) sits behind the caret. `summaryRow` is
// always-visible content belonging to the row (the files a call touched), laid
// out between the header and the body so opening the body never moves it. When
// the summary row already carries the target (as a chip), `hideTarget` keeps
// it from appearing twice.
//
// `expandable: false` is the visual-only mode used by the file rows: no caret
// and no raw args/output card, because the chips and the Review panel are the
// detail. An error or pictures still surface inline since nothing else
// carries them. `label` overrides the derived verb/target for a row that
// speaks for several calls at once.
export function ToolLine({
  event,
  output,
  images,
  error = false,
  interrupted = false,
  running = false,
  forceOpen = false,
  onOpenReviewFile,
  summaryRow,
  hideTarget = false,
  expandable = true,
  label,
}: {
  event: TranscriptEvent;
  output?: string;
  images?: string[];
  error?: boolean;
  interrupted?: boolean;
  running?: boolean;
  forceOpen?: boolean;
  onOpenReviewFile?: OpenReviewFileHandler;
  summaryRow?: React.ReactNode;
  hideTarget?: boolean;
  expandable?: boolean;
  label?: ToolCallLabel;
}) {
  const call = label ?? describeToolCall(event.toolName, event.toolArgs);
  // A call made with no arguments shows none, not an empty "{}".
  const argsText = safeJson(event.toolArgs);
  const args = argsText === '{}' ? '' : argsText;
  const out = output ? stripAnsi(output).trimEnd() : '';
  const [open, setOpen] = useState(false);
  const expanded = open || forceOpen;
  // Only a row with output, text or pictures, can be collapsed again; detailed
  // density still opens every call to its arguments, result or not.
  const collapsible = expandable && (out.length > 0 || Boolean(images?.length));
  const hasBody = expandable && (collapsible || (forceOpen && args.length > 0));
  // In visual-only mode a failure has no body to hide in, so it shows inline;
  // pictures always render, they are content rather than detail.
  const inlineError = !expandable && error && out.length > 0;
  const inlineImages = !expandable ? (images ?? []) : [];
  // An MCP tool wears its server's mark instead of spelling its source.
  const mark = useToolSourceMark(call.source);
  const verb = (
    <span className="flex shrink-0 items-center">
      {mark && <LinkBadge link={mark} />}
      {running ? (
        <span className="shimmer-text font-medium">{call.liveVerb}</span>
      ) : (
        <span className="text-secondary">{call.verb}</span>
      )}
    </span>
  );
  const toggle = () => {
    setOpen((o) => !o);
  };
  return (
    <div>
      <div className="group flex min-w-0 items-center gap-1.5 text-body">
        {collapsible ? (
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            className="flex shrink-0 items-center text-left"
          >
            {verb}
          </button>
        ) : (
          verb
        )}
        {!hideTarget && <ToolTarget call={call} onOpenReviewFile={onOpenReviewFile} />}
        {call.source && !mark && <span className="shrink-0 text-muted/60">· {call.source}</span>}
        {collapsible && (
          // The verb is the accessible toggle; the chevron repeats it for the pointer.
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={toggle}>
            <Caret open={expanded} />
          </button>
        )}
        {interrupted ? <InterruptedTag /> : error && <ErrorTag />}
      </div>
      {summaryRow}
      {hasBody && (
        <Expand open={expanded}>
          <div className="mt-1.5 pl-5">
            <ToolCallCard
              heading={
                args ? (
                  <pre className="whitespace-pre-wrap break-words text-primary">{args}</pre>
                ) : null
              }
              output={out}
              images={images}
              error={error}
            />
          </div>
        </Expand>
      )}
      {inlineError && (
        <pre className="mt-1.5 max-h-56 overflow-auto rounded-sm bg-danger-soft px-2.5 py-2 font-mono text-code break-words whitespace-pre-wrap text-danger">
          {linkify(out)}
        </pre>
      )}
      {inlineImages.map((image, index) => (
        <div key={`${String(index)}-${image}`} className="mt-1.5">
          <TranscriptImage reference={image} />
        </div>
      ))}
    </div>
  );
}
