import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStoreApi, useStoreDispatch } from '../../hooks/useStore';
import { discardImage } from '../../lib/desktop';
import { toast } from '../../lib/toast';
import { bindCaptureDestination, createCaptureGeneration } from './composerDestination';
import { captureApi, type CaptureAttachment } from './types';

const CaptureDialog = lazy(() => import('./CaptureDialog'));
interface Selection {
  captureId?: string;
  replaceImageId?: string;
  generation: number;
}
interface CaptureIntake {
  addCapture(
    task: Promise<CaptureAttachment>,
    sequence: number,
    replaceImageId?: string,
  ): Promise<boolean>;
}

export function useCaptureComposer(
  targetKey: string,
  intake: CaptureIntake,
  reserveSequence: () => number,
) {
  const store = useStoreApi();
  const dispatch = useStoreDispatch();
  const [generation] = useState(createCaptureGeneration);
  const [selection, setSelection] = useState<Selection | null>(null);
  const invalidate = useCallback(() => {
    generation.invalidate();
    setSelection(null);
  }, [generation]);
  useLayoutEffect(() => {
    invalidate();
    return () => generation.invalidate();
  }, [targetKey, generation, invalidate]);
  function open() {
    if (!window.droidCapture) {
      toast.error('Capture needs the DROIDEX desktop app');
      return;
    }
    generation.invalidate();
    if (store.getState().settingsOpen) dispatch({ type: 'TOGGLE_SETTINGS' });
    setSelection({ generation: generation.stamp() });
  }
  function edit(captureId: string, replaceImageId: string) {
    generation.invalidate();
    setSelection({ captureId, replaceImageId, generation: generation.stamp() });
  }
  async function attach(id: string, stamp = generation.stamp(), replaceImageId?: string) {
    if (!generation.isCurrent(stamp))
      throw new DOMException('The original composer is no longer active', 'AbortError');
    const sequence = reserveSequence();
    const pending = captureApi()
      .attach(id)
      .then(async (attachment) => {
        if (!generation.isCurrent(stamp)) {
          await discardImage(attachment.path);
          throw new DOMException('The draft changed; the capture remains in Recents', 'AbortError');
        }
        return attachment;
      });
    const attached = await intake.addCapture(pending, sequence, replaceImageId);
    if (!attached)
      throw new DOMException('The draft changed; the capture remains in Recents', 'AbortError');
  }
  const latest = useRef({ open, attach });
  latest.current = { open, attach };
  useEffect(
    () =>
      bindCaptureDestination({
        open: () => latest.current.open(),
        attach: (id) => latest.current.attach(id),
      }),
    [],
  );
  return {
    open,
    edit,
    invalidate,
    surface: selection ? (
      <Suspense
        fallback={
          <div
            className="fixed bottom-6 right-6 z-[150] rounded-xl bg-droid-elevated px-4 py-3 text-sm text-droid-text"
            role="status"
          >
            Opening Capture…
          </div>
        }
      >
        <CaptureDialog
          captureId={selection.captureId}
          onClose={invalidate}
          onAttach={(id) => attach(id, selection.generation, selection.replaceImageId)}
        />
      </Suspense>
    ) : null,
  };
}
