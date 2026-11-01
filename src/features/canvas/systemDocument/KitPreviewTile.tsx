// One kit preview's tile in the document (spec §7): the item at its own size,
// scaled down to the column and never up. While it holds a live slot it runs in
// a kit-bound guest and shows the draft's token values; otherwise it shows its
// capture, or a quiet placeholder before it has ever rendered live in this mode.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Badge } from '../../../components/ui/Badge';
import { cn } from '../../../components/ui/cn';
import {
  bindCanvasPreviewGuest,
  cancelCanvasPreviewCapture,
  captureCanvasPreview,
  canvasPreviewUrl,
  terminateCanvasPreviewGuest,
} from '../../../lib/desktop';
import { canvasClient } from '../canvasClient';
import { canvasMessage } from '../client';
import { keepKitCapture, useKitCapture } from '../kitCaptures';
import { createGuestElement } from '../previewGuestElement';
import { startPreview, type PreviewRun } from '../previewRuntime';
import type { DesignSystemRef } from '../protocol';

/** What every tile of one document shares. */
export interface KitPreviewing {
  /** The version the previews build from, in the previewed mode. */
  kit: DesignSystemRef;
  /** The draft's valid token values in this mode that differ from the version's. */
  draftTokens: Readonly<Record<string, string>>;
  /** The items holding a live slot. */
  live: readonly string[];
  /** The ref that tells the slots where an item's tile is. */
  observe: (item: string) => (tile: HTMLElement | null) => void;
}

/** Long enough after `ready` for the first paint to settle, as the board waits for its thumbnails. */
const CAPTURE_DELAY_MS = 150;

/** Every mount takes the next number, so a replacement is never this instance. */
let kitPreviewMounts = 0;

export function KitPreviewTile({
  previewing,
  item,
  label,
  width,
  height,
  placeholder,
}: {
  previewing: KitPreviewing;
  /** A preview's id, or `cover`. */
  item: string;
  /** The tile's accessible name. */
  label: string;
  width: number;
  height: number;
  /** What shows before the item has a capture. */
  placeholder: ReactNode;
}) {
  const { kit, draftTokens, live, observe } = previewing;
  const still = useKitCapture(kit, item);
  // Read too, so a mode without a capture yet shows the other one dimmed, not a placeholder.
  const otherStill = useKitCapture({ ...kit, mode: kit.mode === 'light' ? 'dark' : 'light' }, item);
  const fitRef = useRef<HTMLDivElement>(null);
  const scale = useFitScale(fitRef, width);
  const isLive = live.includes(item);
  const isDrafted = Object.keys(draftTokens).length > 0;
  const isSavedLook = !isLive && Boolean(still) && isDrafted;
  const isNeverCaptured = still === null && otherStill === null;
  return (
    <div
      ref={observe(item)}
      role="img"
      aria-label={isSavedLook ? `${label}, saved version` : label}
      className="relative w-full overflow-hidden rounded-lg bg-surface"
      style={{ maxWidth: width, aspectRatio: `${String(width)} / ${String(height)}` }}
    >
      <div ref={fitRef} aria-hidden className="absolute inset-0">
        {isNeverCaptured && placeholder}
        {otherStill && <Still src={otherStill} className="opacity-50" />}
        {still && <Still key={kit.mode} src={still} className="kit-tile-reveal" />}
        {isLive && scale > 0 && (
          <KitGuest
            key={JSON.stringify([kit.id, kit.version, kit.mode, item])}
            kit={kit}
            item={item}
            width={width}
            height={height}
            scale={scale}
            draftTokens={draftTokens}
            wantsCapture={still === null}
          />
        )}
        {isSavedLook && <Badge className="absolute right-2 top-2">Saved version</Badge>}
      </div>
    </div>
  );
}

type ArtifactRead =
  | { status: 'loading' }
  | { status: 'ready'; html: string }
  | { status: 'failed'; message: string };

/**
 * The live guest, keyed by kit version, mode and item. Pointer events reach it,
 * so hover and press show the kit's states, but Tab never enters it.
 */
function KitGuest({
  kit,
  item,
  width,
  height,
  scale,
  draftTokens,
  wantsCapture,
}: {
  kit: DesignSystemRef;
  item: string;
  width: number;
  height: number;
  scale: number;
  draftTokens: Readonly<Record<string, string>>;
  /** The item has no capture in this mode yet, so its first render becomes one. */
  wantsCapture: boolean;
}) {
  const { id, version, mode } = kit;
  const host = useRef<HTMLDivElement>(null);
  const runRef = useRef<PreviewRun | null>(null);
  const tokens = useRef(draftTokens);
  tokens.current = draftTokens;
  const capturing = useRef(wantsCapture);
  capturing.current = wantsCapture;
  const [read, setRead] = useState<ArtifactRead>({ status: 'loading' });
  const [phase, setPhase] = useState<'mounting' | 'ready' | 'lost'>('mounting');
  const html = read.status === 'ready' ? read.html : null;

  useEffect(() => {
    let wanted = true;
    canvasClient.designSystems.readPreview({ id, version, mode }, item).then(
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
  }, [id, version, mode, item]);

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
      if (!capturing.current || isDrafted()) return;
      const requestId = crypto.randomUUID();
      captureId = requestId;
      captureCanvasPreview({
        requestId,
        guestId: guest.getWebContentsId(),
        canvasId: null,
        designId: item,
        revisionId,
        generation,
        width,
        height,
        scaleFactor: window.devicePixelRatio,
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
        designId: item,
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
  }, [html, id, version, mode, item, width, height]);

  useEffect(() => {
    runRef.current?.setTokens(draftTokens);
  }, [draftTokens]);

  return (
    <>
      <div
        ref={host}
        className="kit-tile-fade absolute left-0 top-0 origin-top-left"
        style={{
          width,
          height,
          transform: `scale(${String(scale)})`,
          opacity: phase === 'ready' ? 1 : 0,
        }}
      />
      {read.status === 'failed' && <TileNote text={read.message} />}
      {phase === 'lost' && <TileNote text="This preview is no longer running." />}
    </>
  );
}

function Still({ src, className }: { src: string; className: string }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={cn('absolute inset-0 size-full object-cover', className)}
    />
  );
}

function TileNote({ text }: { text: string }) {
  return (
    <p className="absolute inset-x-2 bottom-2 line-clamp-2 rounded-md bg-raised px-2 py-1 text-caption text-secondary shadow-sm">
      {text}
    </p>
  );
}

/** The tile's width over the item's, at most 1, or 0 before it is measured. */
function useFitScale(ref: RefObject<HTMLElement | null>, width: number): number {
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = (shown: number) => {
      setScale(Math.min(1, shown / width));
    };
    measure(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      measure(entry.contentRect.width);
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref, width]);
  return scale;
}
