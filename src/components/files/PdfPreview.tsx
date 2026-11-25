import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight } from '@droidex/icons';
import { loadPdfDocumentForPreview } from '../../lib/filePreview';
import { Button } from '../ui/Button';
import { PreviewProblem } from './PreviewStatus';

const PDF_RENDER_SCALE = 1.4;

async function loadPdfjsImpl() {
  const pdfjsLib = await import('pdfjs-dist');
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline');
  return { pdfjsLib, PreviewWorker: workerModule.default };
}

let pdfjsModulePromise: ReturnType<typeof loadPdfjsImpl> | null = null;
function loadPdfjs(): ReturnType<typeof loadPdfjsImpl> {
  pdfjsModulePromise ??= loadPdfjsImpl();
  return pdfjsModulePromise;
}

export function PdfPreview({ bytes }: { bytes: Uint8Array }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const numPages = document?.numPages ?? 0;
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    setPage(1);
    setDocument(null);
    setError('');
    setRendering(true);
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    let worker: Worker | null = null;
    let pdfWorker: PDFWorker | null = null;
    loadPdfDocumentForPreview(
      async () => {
        const { pdfjsLib, PreviewWorker } = await loadPdfjs();
        return {
          getDocument: (input) => {
            worker = new PreviewWorker();
            pdfWorker = pdfjsLib.PDFWorker.create({ port: worker });
            return pdfjsLib.getDocument({ ...input, worker: pdfWorker });
          },
        };
      },
      bytes,
      () => cancelled,
      (task) => {
        loadingTask = task;
      },
    )
      .then((doc) => {
        if (!doc) return;
        setDocument(doc);
        setRendering(false);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      const disposeWorker = () => {
        pdfWorker?.destroy();
        worker?.terminate();
      };
      void Promise.resolve()
        .then(() => loadingTask?.destroy())
        .finally(disposeWorker)
        .catch((err: unknown) => {
          console.error('Failed to clean up PDF preview', err);
        });
    };
  }, [bytes]);

  useEffect(() => {
    const doc = document;
    if (!doc || !numPages || !canvasRef.current) return;
    let cancelled = false;
    const isCancelled = () => cancelled;
    let renderTask: RenderTask | null = null;
    setError('');
    setRendering(true);
    Promise.resolve()
      .then(async () => {
        const pdfPage = await doc.getPage(page);
        if (isCancelled()) return;
        const viewport = pdfPage.getViewport({ scale: PDF_RENDER_SCALE });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderTask = pdfPage.render({ canvas, canvasContext: ctx, viewport });
        await renderTask.promise;
        if (!isCancelled()) setRendering(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'RenderingCancelledException') return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [page, numPages, document]);

  return (
    <div className="flex h-full flex-col overflow-auto bg-surface/20 p-4">
      {error && <PreviewProblem title="Couldn't render this PDF" detail={error} />}
      <canvas
        hidden={!!error}
        ref={canvasRef}
        className="mx-auto max-h-full rounded-sm shadow-lg"
        style={{ maxHeight: 'calc(100% - 32px)' }}
      />
      {numPages > 1 && (
        <div className="mx-auto mt-2 flex items-center gap-1 rounded-lg bg-elevated p-1">
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronLeft}
            aria-label="Previous page"
            disabled={page <= 1 || rendering}
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
            }}
          />
          <span className="px-1 text-caption tabular-nums text-secondary">
            {page} / {numPages}
          </span>
          <Button
            variant="ghost"
            size="sm"
            icon={ChevronRight}
            aria-label="Next page"
            disabled={page >= numPages || rendering}
            onClick={() => {
              setPage((p) => Math.min(numPages, p + 1));
            }}
          />
        </div>
      )}
    </div>
  );
}
