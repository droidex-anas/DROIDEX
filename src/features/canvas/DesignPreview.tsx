// One frame's live preview. A built revision is mounted in a `<webview>` guest
// holding the owned intermediate (spec §6), filling the frame's sheet; a failed
// latest build shows its diagnostics over the last revision that still works,
// and so does a design that throws while it runs.
//
// This component owns one guest and reports only bounded preview facts upward.

import { useEffect, useRef, useState } from 'react';
import {
  bindCanvasPreviewGuest,
  canvasPreviewUrl,
  terminateCanvasPreviewGuest,
} from '../../lib/desktop';
import { diagnosticPlace, missingLabel } from './previewLabels';
import { CanvasImageError, captureCanvasImage, registerCanvasPreview } from './captureCanvasImage';
import { startPreview, type PreviewLostReason, type PreviewRun } from './previewRuntime';
import { useCanvasMotion } from './useCanvasMotion';
import type { CanvasDiagnostic, CanvasFrame, PreviewArtifact, PreviewReport } from './protocol';

export interface DesignPreviewProps {
  canvasId: string;
  frame: CanvasFrame;
  /** The revision on show: the frame's working one, or the one it showed before a newer build. */
  revisionId: string;
  /** The artifact for one revision, or null once the derived cache lost it. */
  readArtifact: (
    canvasId: string,
    designId: string,
    revisionId: string,
  ) => Promise<PreviewArtifact | null>;
  /** What a mounted preview did, for the agent that wrote the design. */
  reportPreview: (canvasId: string, report: PreviewReport) => void;
  /** The content size a mounted preview reports, so the board can fit it. */
  onResize?: (designId: string, size: { width: number; height: number }) => void;
}

/** Every mount takes the next number, so a replacement is never this instance. */
let previewMounts = 0;

/** How many reported diagnostics one preview keeps on screen, and reports. */
const SHOWN_PREVIEW_DIAGNOSTICS = 8;

/** The diagnostics a design throws itself, as opposed to the host's own notes. */
const THROWN_CODES = new Set(['preview_error', 'render_failed']);
/** The host's word for a root render that failed before the design painted. */
const RENDER_FAILED = 'render_failed';

export function DesignPreview({
  canvasId,
  frame,
  revisionId,
  readArtifact,
  reportPreview,
  onResize,
}: DesignPreviewProps) {
  const read = useArtifact(canvasId, frame, revisionId, readArtifact, reportPreview);
  const { build } = frame;

  if (read.state !== 'found') return <PreviewPlacard label={missingLabel(read.state, build)} />;
  return (
    <PreviewGuestFrame
      // A revision's artifact never changes, so a newer build attempt is no
      // reason to tear down the design someone may be using.
      key={`${frame.designId}:${read.artifact.artifactId}`}
      canvasId={canvasId}
      designId={frame.designId}
      revisionId={revisionId}
      // Spec §5: a failed revision labels the older working preview it is showing.
      showingRevisionId={build.status === 'failed' ? revisionId : null}
      html={read.artifact.html}
      diagnostics={build.status === 'failed' ? build.diagnostics : []}
      reportPreview={reportPreview}
      onResize={onResize}
    />
  );
}

/** What one read of a revision's artifact concluded. */
type ArtifactRead =
  | { state: 'loading' }
  | { state: 'found'; artifact: PreviewArtifact }
  /** The derived cache does not have it; whether that is being fixed is the
   * frame's business, not this read's. */
  | { state: 'missing' }
  | { state: 'unreadable' };

const LOADING: ArtifactRead = { state: 'loading' };

/**
 * The artifact for one revision. Starting the read is when this pane tells the
 * agent a preview is on its way, well inside the moment a write waits to hear it.
 *
 * A found artifact is kept: a revision's document never changes, and re-reading
 * on every build move would tear down the preview each time a newer revision
 * starts building. A miss is read again whenever the frame's build actually
 * moves, by `generation` and status rather than the build object's identity,
 * because a recovered document arrives under a new attempt, not a new name, and
 * an arrange re-sends every frame with a fresh object and an unchanged build.
 */
function useArtifact(
  canvasId: string,
  { designId, build }: CanvasFrame,
  revisionId: string,
  readArtifact: DesignPreviewProps['readArtifact'],
  reportPreview: DesignPreviewProps['reportPreview'],
): ArtifactRead {
  const [read, setRead] = useState<{ revisionId: string; result: ArtifactRead } | null>(null);
  const found = read?.revisionId === revisionId && read.result.state === 'found';
  const attempt = found ? 'found' : `${build.status}:${String(build.generation)}`;

  useEffect(() => {
    if (found) return;
    let wanted = true;
    reportPreview(canvasId, { designId, revisionId, outcome: 'loading', errors: [] });
    readArtifact(canvasId, designId, revisionId).then(
      (artifact) => {
        if (wanted)
          setRead({
            revisionId,
            result: artifact ? { state: 'found', artifact } : { state: 'missing' },
          });
      },
      (error: unknown) => {
        console.error('A Canvas preview artifact could not be read:', error);
        if (wanted) setRead({ revisionId, result: { state: 'unreadable' } });
      },
    );
    return () => {
      wanted = false;
    };
  }, [canvasId, designId, revisionId, attempt, found, readArtifact, reportPreview]);

  return read?.revisionId === revisionId ? read.result : LOADING;
}

/**
 * The guest itself, mounted once per artifact because the parent keys it by one.
 * The element is created outside React: the runtime drives it through the webview
 * element API, and removing it on unmount is what releases the guest's processes.
 */
export function PreviewGuestFrame({
  canvasId,
  designId,
  revisionId,
  showingRevisionId,
  html,
  diagnostics,
  reportPreview,
  onResize,
}: {
  canvasId: string;
  designId: string;
  revisionId: string;
  /** Named when this is an older working revision rather than the frame's own. */
  showingRevisionId: string | null;
  html: string;
  diagnostics: CanvasDiagnostic[];
  reportPreview: DesignPreviewProps['reportPreview'];
  onResize: DesignPreviewProps['onResize'];
}) {
  const motion = useCanvasMotion();
  const host = useRef<HTMLDivElement>(null);
  const resized = useRef(onResize);
  resized.current = onResize;
  const reported = useRef(reportPreview);
  reported.current = reportPreview;
  const [phase, setPhase] = useState<'mounting' | 'ready' | PreviewLostReason>('mounting');
  // Only what the design threw: the host's own notes would crowd it out.
  const [thrown, setThrown] = useState<CanvasDiagnostic[]>([]);

  useEffect(() => {
    const container = host.current;
    const url = canvasPreviewUrl();
    if (!container || url === null) return;
    const guest = createGuestElement(url);
    let run: PreviewRun | null = null;
    let mounted = true;
    let releaseCapture: (() => void) | null = null;
    let captureSize = '';
    const mountGeneration = (previewMounts += 1);
    const thumbnailCapture = new AbortController();
    let thumbnailTimer: ReturnType<typeof setTimeout> | null = null;
    const updateCapture = () => {
      const width = guest.offsetWidth;
      const height = guest.offsetHeight;
      const scaleFactor = window.devicePixelRatio;
      const size = `${String(width)}:${String(height)}:${String(scaleFactor)}`;
      if (captureSize === size) return;
      captureSize = size;
      if (thumbnailTimer) clearTimeout(thumbnailTimer);
      releaseCapture?.();
      releaseCapture = null;
      if (width < 1 || height < 1) return;
      let guestId: number;
      try {
        guestId = guest.getWebContentsId();
      } catch {
        return;
      }
      if (!Number.isSafeInteger(guestId) || guestId < 1) return;
      releaseCapture = registerCanvasPreview(
        canvasId,
        { designId, revisionId },
        {
          guestId,
          generation: mountGeneration,
          width,
          height,
          scaleFactor,
        },
      );
      thumbnailTimer = setTimeout(() => {
        thumbnailTimer = null;
        void captureCanvasImage(canvasId, { designId, revisionId }, thumbnailCapture.signal).catch(
          (error: unknown) => {
            if (!(error instanceof CanvasImageError))
              console.error('A Canvas thumbnail could not be captured:', error);
          },
        );
      }, 150);
    };
    const sizeObserver = new ResizeObserver(updateCapture);
    // What the agent hears once the artifact read has said `loading`: rendered
    // once the design paints, failed when its root render failed or it stalled
    // before painting, and the first few errors it throws. A design that throws
    // in a loop sends nothing new once those are held.
    let painted = false;
    let sent: PreviewReport['outcome'] | null = null;
    const errors: string[] = [];
    const report = (outcome: PreviewReport['outcome'], thrown: string[] = []) => {
      const fresh = thrown.slice(0, SHOWN_PREVIEW_DIAGNOSTICS - errors.length);
      if (outcome === sent && fresh.length === 0) return;
      errors.push(...fresh);
      sent = outcome;
      reported.current(canvasId, { designId, revisionId, outcome, errors: [...errors] });
    };

    // Main binds the guest to this canvas before a design runs in it, so the
    // design can only ever read its own canvas's assets. A guest main refuses
    // to bind never gets a design at all.
    async function bindAndStart() {
      const guestId = guest.getWebContentsId();
      let bound = false;
      try {
        bound = await bindCanvasPreviewGuest(guestId, canvasId);
      } catch (error) {
        console.error('A Canvas preview could not be bound to its canvas:', error);
      }
      if (!mounted) return;
      if (!bound) {
        setPhase('guest_gone');
        void terminateCanvasPreviewGuest(guestId);
        return;
      }
      run = startPreview({
        guest,
        designId,
        revisionId,
        generation: mountGeneration,
        html,
        terminate: terminateCanvasPreviewGuest,
        observer: {
          onReady: () => {
            painted = true;
            report('rendered');
            setPhase('ready');
            updateCapture();
            sizeObserver.observe(guest);
          },
          onResize: (size) => resized.current?.(designId, size),
          onDiagnostics: (entries) => {
            const fresh = entries.filter((entry) => THROWN_CODES.has(entry.code));
            if (fresh.length === 0) return;
            setThrown((held) => [...held, ...fresh].slice(-SHOWN_PREVIEW_DIAGNOSTICS));
            const stopped = fresh.some((entry) => entry.code === RENDER_FAILED);
            report(
              stopped ? 'failed' : (sent ?? 'loading'),
              fresh.map((entry) => entry.message),
            );
          },
          onLost: (reason) => {
            // A guest the board lost is not the design's fault; a stall is.
            if (reason !== 'guest_gone')
              report(painted ? 'rendered' : 'failed', [lostLabel(reason)]);
            thumbnailCapture.abort();
            if (thumbnailTimer) clearTimeout(thumbnailTimer);
            releaseCapture?.();
            releaseCapture = null;
            sizeObserver.disconnect();
            setPhase(reason);
          },
        },
      });
    }

    guest.addEventListener(
      'dom-ready',
      () => {
        if (!mounted) return;
        void bindAndStart();
      },
      { once: true },
    );
    container.append(guest);
    return () => {
      mounted = false;
      thumbnailCapture.abort();
      if (thumbnailTimer) clearTimeout(thumbnailTimer);
      releaseCapture?.();
      sizeObserver.disconnect();
      run?.stop();
      guest.remove();
    };
  }, [canvasId, designId, revisionId, html]);

  const lost = phase !== 'mounting' && phase !== 'ready' ? phase : null;
  const isReady = phase === 'ready';
  const transition =
    isReady && motion.readyMs > 0
      ? `opacity ${String(motion.readyMs)}ms ${motion.easeCss}`
      : undefined;
  return (
    <div data-preview-phase={phase} className="relative h-full w-full">
      <div
        ref={host}
        className="h-full w-full"
        hidden={lost !== null}
        style={{
          opacity: isReady ? 1 : 0,
          transition,
        }}
      />
      {lost === null && (
        <div
          aria-hidden={isReady}
          className="pointer-events-none absolute inset-0"
          style={{ opacity: isReady ? 0 : 1, transition }}
        >
          <PreviewPlacard label="Loading this preview…" />
        </div>
      )}
      {lost ? <PreviewPlacard label={lostLabel(lost)} /> : null}
      {/* Spec §5: a failed revision labels the older working preview it shows. */}
      {showingRevisionId !== null && (
        <PreviewNotice
          title="Latest change didn’t build"
          diagnostics={diagnostics}
          note="Showing the last version that built."
        />
      )}
      {showingRevisionId === null && thrown.length > 0 && (
        <PreviewNotice title="This design threw an error" diagnostics={thrown} />
      )}
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

/** A quiet line, centred on the sheet at screen size, while there is nothing to see. */
function PreviewPlacard({ label }: { label: string }) {
  return (
    <div className="canvas-sheet-state">
      <div className="canvas-sheet-message canvas-chrome">
        <p className="canvas-sheet-detail">{label}</p>
      </div>
    </div>
  );
}

/** What went wrong, across the sheet's bottom edge, over the design it concerns. */
function PreviewNotice({
  title,
  diagnostics,
  note,
}: {
  title: string;
  diagnostics: CanvasDiagnostic[];
  note?: string;
}) {
  const first = diagnostics.at(0);
  const more = diagnostics.length - 1;
  const place = first ? diagnosticPlace(first) : null;
  return (
    <div role="status" className="canvas-sheet-banner">
      <p className="canvas-sheet-title">{title}</p>
      {first && (
        <p className="canvas-sheet-detail canvas-sheet-clamp">
          {place && <strong>{place} · </strong>}
          {first.message}
          {more > 0 ? ` (and ${String(more)} more)` : ''}
        </p>
      )}
      {note && <p className="canvas-sheet-detail">{note}</p>}
    </div>
  );
}
