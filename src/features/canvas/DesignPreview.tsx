// One frame's live preview. A built revision is mounted in a `<webview>` guest
// holding the owned intermediate (spec §6); every other build state is a quiet
// labeled surface, and a failed build shows its diagnostics above the last
// revision that still works.
//
// Task 5 owns the board, the live-preview slots and the real Retry; this
// component owns one frame and reports only bounded preview facts upward.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { canvasPreviewUrl, terminateCanvasPreviewGuest } from '../../lib/desktop';
import { startPreview, type PreviewLostReason, type PreviewRun } from './previewRuntime';
import type { CanvasBuildState, CanvasDiagnostic, CanvasFrame, PreviewArtifact } from './protocol';

export interface DesignPreviewProps {
  canvasId: string;
  frame: CanvasFrame;
  /** The artifact for one revision, or null once the derived cache lost it. */
  readArtifact: (
    canvasId: string,
    designId: string,
    revisionId: string,
  ) => Promise<PreviewArtifact | null>;
  /** Asks the runtime to build this board's frames again. */
  onRefresh: () => void;
  /** The content size a mounted preview reports, so the board can fit it. */
  onResize?: (designId: string, size: { width: number; height: number }) => void;
}

/** Every mount takes the next number, so a replacement is never this instance. */
let previewMounts = 0;

/** How many reported diagnostics one preview keeps on screen. */
const SHOWN_PREVIEW_DIAGNOSTICS = 8;

export function DesignPreview({
  canvasId,
  frame,
  readArtifact,
  onRefresh,
  onResize,
}: DesignPreviewProps) {
  const revisionId = previewRevisionId(frame.build);
  const artifact = useArtifact(canvasId, frame.designId, revisionId, readArtifact);
  const failures = frame.build.status === 'failed' ? frame.build.diagnostics : [];

  // A build that failed with nothing to fall back to still says why.
  if (revisionId === null)
    return <PreviewPlacard label={waitingLabel(frame.build)} diagnostics={failures} />;
  if (artifact === 'loading') return <PreviewPlacard label="Loading this preview…" />;
  if (artifact === null) {
    return (
      <PreviewPlacard label="This preview has to be built again." diagnostics={failures}>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg bg-droid-elevated px-3 py-1.5 text-[12px] font-medium text-droid-text transition-colors hover:bg-droid-active"
        >
          Retry
        </button>
      </PreviewPlacard>
    );
  }
  return (
    <PreviewGuestFrame
      key={`${frame.designId}:${artifact.artifactId}`}
      designId={frame.designId}
      revisionId={revisionId}
      html={artifact.html}
      diagnostics={failures}
      onResize={onResize}
    />
  );
}

/** The revision whose artifact this frame shows, if any is worth asking for. */
function previewRevisionId(build: CanvasBuildState): string | null {
  if (build.status === 'ready') return build.revisionId;
  if (build.status === 'failed') return build.lastWorkingRevisionId;
  return null;
}

function waitingLabel(build: CanvasBuildState): string {
  switch (build.status) {
    case 'building':
      return 'Building this design…';
    case 'cancelled':
      return 'This build was cancelled.';
    case 'failed':
      return 'This design has no working preview yet.';
    default:
      return 'Waiting to build…';
  }
}

/**
 * The artifact for one revision, reloaded whenever the frame points somewhere
 * else. `'loading'` is the state before the first answer; null means the derived
 * cache no longer has it and the design needs building again.
 */
function useArtifact(
  canvasId: string,
  designId: string,
  revisionId: string | null,
  readArtifact: DesignPreviewProps['readArtifact'],
): PreviewArtifact | null | 'loading' {
  const [artifact, setArtifact] = useState<PreviewArtifact | null | 'loading'>('loading');

  useEffect(() => {
    if (revisionId === null) return;
    let wanted = true;
    setArtifact('loading');
    readArtifact(canvasId, designId, revisionId).then(
      (loaded) => {
        if (wanted) setArtifact(loaded);
      },
      (error: unknown) => {
        console.error('A Canvas preview artifact could not be read:', error);
        if (wanted) setArtifact(null);
      },
    );
    return () => {
      wanted = false;
    };
  }, [canvasId, designId, revisionId, readArtifact]);

  return artifact;
}

/**
 * The guest itself, mounted once per artifact because the parent keys it by one.
 * The element is created outside React: the runtime drives it through the webview
 * element API, and removing it on unmount is what releases the guest's processes.
 */
function PreviewGuestFrame({
  designId,
  revisionId,
  html,
  diagnostics,
  onResize,
}: {
  designId: string;
  revisionId: string;
  html: string;
  diagnostics: CanvasDiagnostic[];
  onResize: DesignPreviewProps['onResize'];
}) {
  const host = useRef<HTMLDivElement>(null);
  const resized = useRef(onResize);
  resized.current = onResize;
  const [phase, setPhase] = useState<'mounting' | 'ready' | PreviewLostReason>('mounting');
  const [reported, setReported] = useState<CanvasDiagnostic[]>([]);

  useEffect(() => {
    const container = host.current;
    const url = canvasPreviewUrl();
    if (!container || url === null) return;
    const guest = createGuestElement(url);
    let run: PreviewRun | null = null;
    let mounted = true;
    guest.addEventListener(
      'dom-ready',
      () => {
        if (!mounted) return;
        run = startPreview({
          guest,
          designId,
          revisionId,
          generation: (previewMounts += 1),
          html,
          terminate: terminateCanvasPreviewGuest,
          observer: {
            onReady: () => {
              setPhase('ready');
            },
            onResize: (size) => resized.current?.(designId, size),
            onDiagnostics: (entries) => {
              setReported((held) => [...held, ...entries].slice(-SHOWN_PREVIEW_DIAGNOSTICS));
            },
            onLost: setPhase,
          },
        });
      },
      { once: true },
    );
    container.append(guest);
    return () => {
      mounted = false;
      run?.stop();
      guest.remove();
    };
  }, [designId, revisionId, html]);

  const lost = phase !== 'mounting' && phase !== 'ready' ? phase : null;
  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl bg-droid-bg">
        <div ref={host} className="h-full w-full" hidden={lost !== null} />
        {lost ? <PreviewPlacard label={lostLabel(lost)} /> : null}
      </div>
      <PreviewDiagnostics diagnostics={[...diagnostics, ...reported]} />
    </div>
  );
}

/** A guest that can only ever load the owned intermediate. */
function createGuestElement(url: string) {
  const guest = document.createElement('webview') as HTMLElement & {
    getWebContentsId: () => number;
    executeJavaScript: (code: string) => Promise<unknown>;
  };
  guest.setAttribute('src', url);
  guest.style.cssText = 'display:flex;width:100%;height:100%';
  return guest;
}

function lostLabel(reason: PreviewLostReason): string {
  if (reason === 'not_ready') return 'This design did not finish rendering, so it was stopped.';
  if (reason === 'poll_timeout') return 'This preview stopped responding, so it was stopped.';
  return 'This preview is no longer running.';
}

/** A quiet surface for every state that has nothing to render yet. */
function PreviewPlacard({
  label,
  diagnostics = [],
  children,
}: {
  label: string;
  diagnostics?: CanvasDiagnostic[];
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-xl bg-droid-surface p-4 text-center">
      <p className="text-[12px] leading-5 text-droid-text-secondary">{label}</p>
      {children}
      <PreviewDiagnostics diagnostics={diagnostics} />
    </div>
  );
}

function PreviewDiagnostics({ diagnostics }: { diagnostics: CanvasDiagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <ul className="max-h-28 w-full overflow-y-auto rounded-lg bg-droid-elevated px-3 py-2 text-left font-mono text-[11px] leading-[18px] text-droid-text-secondary">
      {diagnostics.map((diagnostic, index) => (
        <li key={`${diagnostic.code}-${String(index)}`} className="whitespace-pre-wrap break-words">
          {diagnostic.file ? `${diagnostic.file}: ` : ''}
          {diagnostic.message}
        </li>
      ))}
    </ul>
  );
}
