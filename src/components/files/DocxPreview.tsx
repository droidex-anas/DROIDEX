import { useEffect, useRef, useState } from 'react';
import {
  createSanitizedDocxElementFactory,
  DOCX_PREVIEW_OPTIONS,
  sanitizeDocxPreview,
} from '../../lib/filePreview';
import { PreviewBusyChip, PreviewProblem } from './PreviewStatus';

export function DocxPreview({ bytes }: { bytes: Uint8Array }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!bytes.length) {
      containerRef.current.replaceChildren();
      setError('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    const isCancelled = () => cancelled;
    const objectUrls = new Set<string>();
    const container = containerRef.current;
    const renderingDocument = document.implementation.createHTMLDocument('');
    const renderedBody = renderingDocument.createElement('div');
    const renderedStyles = renderingDocument.createElement('div');
    container.innerHTML = '';
    setLoading(true);
    setError('');
    import('docx-preview')
      .then(async ({ parseAsync, renderDocument }) => {
        const options = {
          ...DOCX_PREVIEW_OPTIONS,
          h: createSanitizedDocxElementFactory(renderingDocument),
        };
        const document = (await parseAsync(new Blob([bytes as unknown as BlobPart]), options)) as {
          blobToURL: (blob: Blob, path: string) => string | null;
        };
        if (cancelled) return;
        const blobToURL = document.blobToURL.bind(document);
        document.blobToURL = (blob, path) => {
          const url = blobToURL(blob, path);
          if (url?.startsWith('blob:')) {
            if (cancelled) URL.revokeObjectURL(url);
            else objectUrls.add(url);
          }
          return url;
        };
        const nodes = await renderDocument(document, options);
        if (!isCancelled()) {
          for (const node of nodes) {
            (node.nodeName === 'STYLE' ? renderedStyles : renderedBody).appendChild(node);
          }
        }
      })
      .then(() => {
        if (!cancelled) {
          sanitizeDocxPreview(renderedBody);
          sanitizeDocxPreview(renderedStyles);
          container.replaceChildren(
            ...Array.from(renderedStyles.childNodes),
            ...Array.from(renderedBody.childNodes),
          );
          sanitizeDocxPreview(container);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
      container.innerHTML = '';
      for (const url of objectUrls) URL.revokeObjectURL(url);
      objectUrls.clear();
    };
  }, [bytes]);

  if (error) {
    return <PreviewProblem title="Couldn't render this document" detail={error} />;
  }

  return (
    <div className="relative h-full overflow-auto bg-surface/20 p-4">
      {loading && <PreviewBusyChip label="Rendering…" />}
      <div
        ref={containerRef}
        // eslint-disable-next-line design-policy/design-tokens -- rendered document paper: documents are authored black on white
        className="mx-auto max-w-3xl rounded-sm bg-white p-6 text-black shadow-lg"
      />
    </div>
  );
}
