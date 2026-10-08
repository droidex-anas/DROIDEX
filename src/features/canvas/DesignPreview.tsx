// One frame's live preview. A built revision is mounted in a `<webview>` guest
// holding the owned intermediate (spec §6); every other build state is a quiet
// labeled surface, and a failed build shows its diagnostics above the last
// revision that still works.
//
// This component owns one guest and reports only bounded preview facts upward.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  bindCanvasPreviewGuest,
  canvasPreviewUrl,
  terminateCanvasPreviewGuest,
} from '../../lib/desktop';
import { missingLabel, previewRevisionId, waitingLabel } from './previewLabels';
import { CanvasImageError, captureCanvasImage, registerCanvasPreview } from './captureCanvasImage';
import { startPreview, type PreviewLostReason, type PreviewRun } from './previewRuntime';
import { useCanvasMotion } from './useCanvasMotion';
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
  /** The content size a mounted preview reports, so the board can fit it. */
  onResize?: (designId: string, size: { width: number; height: number }) => void;
}

/** Every mount takes the next number, so a replacement is never this instance. */
let previewMounts = 0;

/** How many reported diagnostics one preview keeps on screen. */
const SHOWN_PREVIEW_DIAGNOSTICS = 8;

export function DesignPreview({ canvasId, frame, readArtifact, onResize }: DesignPreviewProps) {
  const revisionId = previewRevisionId(frame.build);
  const read = useArtifact(canvasId, frame.designId, revisionId, frame.build, readArtifact);
  const failures = frame.build.status === 'failed' ? frame.build.diagnostics : [];

  // A build that failed with nothing to fall back to still says why.
  if (revisionId === null)
    return <PreviewPlacard label={waitingLabel(frame.build)} diagnostics={failures} />;
  if (read.state !== 'found')
    return <PreviewPlacard label={missingLabel(read.state, frame.build)} diagnostics={failures} />;
  return (
    <PreviewGuestFrame
      key={`${frame.designId}:${read.artifact.artifactId}:${String(frame.build.generation)}`}
      canvasId={canvasId}
      designId={frame.designId}
      revisionId={revisionId}
      generation={frame.build.generation}
      // Spec §5: a failed revision labels the older working preview it is showing.
      showingRevisionId={frame.build.status === 'failed' ? revisionId : null}
      html={read.artifact.html}
      diagnostics={failures}
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
 * The artifact for one revision, read again whenever that revision's build
 * actually moves. The signal is `generation` — the registry's per-design attempt
 * counter — and the status, never the build object's identity: an arrange
 * re-sends every frame it touches with a fresh object and an unchanged build, and
 * re-reading there would tear down a loaded preview and lose its state.
 *
 * It is not the artifact ID either, because a rebuild of identical source is
 * content-addressed to the same ID: a recovered document arrives under a new
 * attempt, not under a new name.
 */
function useArtifact(
  canvasId: string,
  designId: string,
  revisionId: string | null,
  build: CanvasBuildState,
  readArtifact: DesignPreviewProps['readArtifact'],
): ArtifactRead {
  const [read, setRead] = useState<ArtifactRead>(LOADING);

  useEffect(() => {
    if (revisionId === null) return;
    let wanted = true;
    setRead(LOADING);
    readArtifact(canvasId, designId, revisionId).then(
      (artifact) => {
        if (wanted) setRead(artifact ? { state: 'found', artifact } : { state: 'missing' });
      },
      (error: unknown) => {
        console.error('A Canvas preview artifact could not be read:', error);
        if (wanted) setRead({ state: 'unreadable' });
      },
    );
    return () => {
      wanted = false;
    };
    // Values, not the build object: see the note above.
  }, [canvasId, designId, revisionId, build.generation, build.status, readArtifact]);

  return read;
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
  generation,
  showingRevisionId,
  html,
  diagnostics,
  onResize,
}: {
  canvasId: string;
  designId: string;
  revisionId: string;
  generation: number;
  /** Named when this is an older working revision rather than the frame's own. */
  showingRevisionId: string | null;
  html: string;
  diagnostics: CanvasDiagnostic[];
  onResize: DesignPreviewProps['onResize'];
}) {
  const motion = useCanvasMotion();
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
            setPhase('ready');
            updateCapture();
            sizeObserver.observe(guest);
          },
          onResize: (size) => resized.current?.(designId, size),
          onDiagnostics: (entries) => {
            setReported((held) => [...held, ...entries].slice(-SHOWN_PREVIEW_DIAGNOSTICS));
          },
          onLost: (reason) => {
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
  }, [canvasId, designId, revisionId, generation, html]);

  const lost = phase !== 'mounting' && phase !== 'ready' ? phase : null;
  const isReady = phase === 'ready';
  const transition =
    isReady && motion.readyMs > 0
      ? `opacity ${String(motion.readyMs)}ms ${motion.easeCss}`
      : undefined;
  return (
    <div data-preview-phase={phase} className="flex h-full w-full flex-col gap-2">
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-droid-bg">
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
      </div>
      {showingRevisionId ? (
        <p className="text-[11px] leading-4 text-droid-text-muted">
          Showing revision {showingRevisionId}
        </p>
      ) : null}
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
