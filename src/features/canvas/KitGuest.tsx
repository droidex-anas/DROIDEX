// A kit preview running live in a kit-bound guest: one preview or catalog
// entry of a saved kit version, or of the proposal under review, at its own
// size and scaled. Its first render in a mode can be kept as that item's
// capture.

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  bindCanvasPreviewGuest,
  cancelCanvasPreviewCapture,
  captureCanvasPreview,
  canvasPreviewUrl,
  terminateCanvasPreviewGuest,
} from '../../lib/desktop';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import { keepKitCapture } from './kitCaptures';
import { createGuestElement } from './previewGuestElement';
import { startPreview, type PreviewRun } from './previewRuntime';
import type { DesignSystemRef, KitPreviewTarget } from './protocol';
import { usePickedColor } from './systemDocument/pickedColor';

/** Long enough after `ready` for the first paint to settle, as the board waits for its thumbnails. */
const CAPTURE_DELAY_MS = 150;

/** Every mount takes the next number, so a replacement is never this instance. */
let kitPreviewMounts = 0;

type ArtifactRead =
  | { status: 'loading' }
  | { status: 'ready'; html: string }
  | { status: 'failed'; message: string };

/**
 * The live guest, keyed by kit version or proposal, mode and target. Pointer
 * events reach it, so hover and press show the kit's states, but Tab never
 * enters it. Only a preview is captured.
 */
export function KitGuest({
  kit,
  target,
  width,
  height,
  scale,
  draftTokens,
  wantsCapture,
}: {
  /** The saved version: what a capture is kept for, and a draft's values change. */
  kit: DesignSystemRef;
  /** Kept stable while the guest lives: a new target is a new guest. */
  target: KitPreviewTarget;
  width: number;
  height: number;
  scale: number;
  draftTokens: Readonly<Record<string, string>>;
  /** The preview has no capture in this mode yet, so its first render becomes one. */
  wantsCapture: boolean;
}) {
  const { id, version, mode } = kit;
  const designId = target.kind === 'preview' ? target.item : target.entry;
  const host = useRef<HTMLDivElement>(null);
  const runRef = useRef<PreviewRun | null>(null);
  // A colour being chosen in the document shows live, like a draft value does.
  const picked = usePickedColor();
  const shownTokens = useMemo(() => {
    if (picked?.kitId !== id) return draftTokens;
    if (picked.mode !== 'both' && picked.mode !== mode) return draftTokens;
    return { ...draftTokens, [picked.name]: picked.value };
  }, [picked, draftTokens, id, mode]);
  const tokens = useRef(shownTokens);
  tokens.current = shownTokens;
  const capturing = useRef(wantsCapture);
  capturing.current = wantsCapture;
  const [read, setRead] = useState<ArtifactRead>({ status: 'loading' });
  const [phase, setPhase] = useState<'mounting' | 'ready' | 'lost'>('mounting');
  const html = read.status === 'ready' ? read.html : null;

  useEffect(() => {
    let wanted = true;
    canvasClient.designSystems.readPreview(target).then(
      (preview) => {
        if (!wanted) return;
        if (preview.status === 'ready') setRead({ status: 'ready', html: preview.artifact.html });
        else
          setRead({
            status: 'failed',
            message: preview.diagnostics.at(0)?.message ?? 'This preview did not build.',
          });
      },
      (error: unknown) => {
        if (wanted) setRead({ status: 'failed', message: canvasMessage(error) });
      },
    );
    return () => {
      wanted = false;
    };
  }, [target]);

  useEffect(() => {
    const container = host.current;
    const url = canvasPreviewUrl();
    if (!container || url === null || html === null) return;
    const guest = createGuestElement(url);
    guest.tabIndex = -1;
    const generation = (kitPreviewMounts += 1);
    const revisionId = `${mode}-v${String(version)}`;
    let mounted = true;
    let run: PreviewRun | null = null;
    let captureTimer: ReturnType<typeof setTimeout> | null = null;
    let captureId: string | null = null;
    const isDrafted = () => Object.keys(tokens.current).length > 0;

    // A capture keeps the saved look, so a guest showing draft values is not taken.
    const capture = () => {
      captureTimer = null;
      if (target.kind !== 'preview' || !capturing.current || isDrafted()) return;
      const { item } = target;
      const requestId = crypto.randomUUID();
      captureId = requestId;
      captureCanvasPreview({
        requestId,
        guestId: guest.getWebContentsId(),
        canvasId: null,
        designId,
        revisionId,
        generation,
        width,
        height,
        scaleFactor: window.devicePixelRatio,
        retain: false,
      })
        .then((result) => {
          captureId = null;
          if (!result.ok || isDrafted()) return;
          return keepKitCapture({ id, version, mode }, item, result.bytes, width);
        })
        .catch((error: unknown) => {
          console.error('A design system preview could not be captured:', error);
        });
    };

    // Main binds the guest to kits before the example runs, so it can read kit
    // fonts and images and nothing a canvas owns.
    async function bindAndStart(source: string) {
      const guestId = guest.getWebContentsId();
      let bound = false;
      try {
        bound = await bindCanvasPreviewGuest(guestId, { kind: 'kit' });
      } catch (error) {
        console.error('A design system preview could not be bound:', error);
      }
      if (!mounted) return;
      if (!bound) {
        setPhase('lost');
        void terminateCanvasPreviewGuest(guestId);
        return;
      }
      run = startPreview({
        guest,
        designId,
        revisionId,
        generation,
        html: source,
        terminate: terminateCanvasPreviewGuest,
        observer: {
          onReady: () => {
            runRef.current = run;
            if (isDrafted()) run?.setTokens(tokens.current);
            setPhase('ready');
            captureTimer = setTimeout(capture, CAPTURE_DELAY_MS);
          },
          onResize: () => undefined,
          onDiagnostics: () => undefined,
          onSelection: () => undefined,
          onLost: () => {
            runRef.current = null;
            if (captureTimer) clearTimeout(captureTimer);
            setPhase('lost');
          },
        },
      });
    }

    guest.addEventListener(
      'dom-ready',
      () => {
        if (mounted) void bindAndStart(html);
      },
      { once: true },
    );
    container.append(guest);
    return () => {
      mounted = false;
      if (captureTimer) clearTimeout(captureTimer);
      if (captureId !== null) void cancelCanvasPreviewCapture(captureId);
      runRef.current = null;
      run?.stop();
      guest.remove();
    };
  }, [html, id, version, mode, target, designId, width, height]);

  useEffect(() => {
    runRef.current?.setTokens(shownTokens);
  }, [shownTokens]);

  let note: string | null = null;
  if (read.status === 'failed') note = read.message;
  else if (phase === 'lost') note = 'This preview is no longer running.';
  return (
    <>
      <div
        ref={host}
        aria-hidden
        className="kit-tile-fade absolute left-0 top-0 origin-top-left"
        style={{
          width,
          height,
          transform: `scale(${String(scale)})`,
          opacity: phase === 'ready' ? 1 : 0,
        }}
      />
      {/* Outside the image and the hidden guest, so assistive tech reads why it failed. */}
      <div role="status" className="absolute inset-x-2 bottom-2">
        {note !== null && (
          <p className="line-clamp-2 rounded-md bg-raised px-2 py-1 text-caption text-secondary shadow-sm">
            {note}
          </p>
        )}
      </div>
    </>
  );
}
