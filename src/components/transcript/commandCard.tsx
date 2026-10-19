import { useContext, useState } from 'react';
import { commandLineContains } from '../../lib/commandLineMatch';
import { LiveProcessesContext } from './liveProcessesContext';
import { stripAnsi } from '../../lib/tools';
import { TranscriptImage } from '../media/TranscriptImage';
import { Caret, ErrorTag, Expand, InterruptedTag, linkify, ToolPanel } from './primitives';

// A backgrounded server keeps its card "running" after the turn ends as long
// as a live agent process still carries the command the agent typed.
function useCommandStillRunning(command: string): boolean {
  const processes = useContext(LiveProcessesContext);
  if (processes.length === 0) return false;
  const needle = command.trim();
  return (
    needle.length > 3 &&
    processes.some(
      (p) =>
        commandLineContains(p.command, needle) ||
        (p.originCommand !== undefined && commandLineContains(p.originCommand, needle)),
    )
  );
}

const NO_IMAGES: string[] = [];

/* ── Terminal-style body shared by every tool call: what was called, then
   what came back, in the same bordered panel language as expanded diffs. No
   header chrome — the heading (a `$` prompt for a shell call, the arguments
   for any other tool) says what this is. ── */
export function ToolCallCard({
  heading,
  output,
  images = NO_IMAGES,
  error = false,
  interrupted = false,
  running = false,
}: {
  heading: React.ReactNode;
  output?: string;
  /** The pictures the tool answered with, as saved files, shown above its text. */
  images?: string[];
  error?: boolean;
  interrupted?: boolean;
  running?: boolean;
}) {
  const out = output ? stripAnsi(output).trimEnd() : '';
  return (
    <ToolPanel className="group relative">
      <div className="px-3.5 py-2.5 font-mono text-code">
        {heading}
        {running && <span className="shimmer-text text-body-strong">Running</span>}
        {interrupted && <InterruptedTag />}
        {images.length > 0 && (
          <div className="mt-2 first:mt-0">
            {images.map((image, index) => (
              // One result can carry the same picture twice.
              <TranscriptImage key={`${String(index)}-${image}`} reference={image} />
            ))}
          </div>
        )}
        {out && (
          <pre
            className={`mt-2 first:mt-0 max-h-56 overflow-auto whitespace-pre-wrap text-code break-words ${error ? 'text-danger' : 'text-muted'}`}
          >
            {error ? out : linkify(out)}
          </pre>
        )}
      </div>
    </ToolPanel>
  );
}

export function CommandCard({
  command,
  output,
  images,
  error = false,
  interrupted = false,
  running = false,
}: {
  command: string;
  output?: string;
  images?: string[];
  error?: boolean;
  interrupted?: boolean;
  running?: boolean;
}) {
  const alive = useCommandStillRunning(command);
  return (
    <ToolCallCard
      heading={
        <div className="flex gap-2 break-words">
          <span className={`select-none ${error ? 'text-danger' : 'text-muted'}`}>$</span>
          <span className="whitespace-pre-wrap text-primary">{command}</span>
        </div>
      }
      output={output}
      images={images}
      error={error}
      interrupted={interrupted}
      running={running || alive}
    />
  );
}

/* ── One-line form of a shell call: "› Ran cmd", expanding to the full
   CommandCard. This is how exec tools render at the compact and balanced
   densities; a failed call carries the error tag on the line itself. ── */
export function CommandLine({
  command,
  output,
  images,
  error = false,
  interrupted = false,
  running = false,
  forceOpen = false,
}: {
  command: string;
  output?: string;
  images?: string[];
  error?: boolean;
  interrupted?: boolean;
  running?: boolean;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const alive = useCommandStillRunning(command);
  const expanded = open || forceOpen;
  const label = (
    <>
      {running || alive ? (
        <span className="shimmer-text shrink-0 font-medium">Running</span>
      ) : (
        <span className="shrink-0 text-secondary">Ran</span>
      )}
      <span className="min-w-0 truncate text-muted">{command}</span>
    </>
  );
  // Only a still-running turn hides the expander: a finished call whose
  // process is still alive already has captured output, and that output must
  // stay reachable. It keeps the Running indicator in place of "Ran".
  if (running) {
    return <div className="flex min-w-0 items-center gap-1.5 text-body">{label}</div>;
  }
  return (
    <div>
      <button
        onClick={() => {
          setOpen((o) => !o);
        }}
        className="group flex w-full min-w-0 items-center gap-1.5 text-left text-body"
        aria-expanded={expanded}
      >
        {label}
        <Caret open={expanded} />
        {interrupted ? <InterruptedTag /> : error && <ErrorTag />}
      </button>
      <Expand open={expanded}>
        <div className="mt-1.5 pl-5">
          <CommandCard command={command} output={output} images={images} error={error} />
        </div>
      </Expand>
    </div>
  );
}
