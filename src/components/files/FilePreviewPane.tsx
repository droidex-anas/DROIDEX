import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FolderSearch,
  Spinner,
} from '@droidex/icons';
import { Highlight } from 'prism-react-renderer';
import { readFilePreview, type FilePreviewPayload } from '../../lib/desktop';
import {
  createSanitizedDocxElementFactory,
  DOCX_PREVIEW_OPTIONS,
  loadPdfDocumentForPreview,
  parseDelimitedText,
  sanitizeDocxPreview,
} from '../../lib/filePreview';
import { Markdown } from '../Markdown';
import { CODE_THEME } from '../MarkdownCode';
import { Button } from '../ui/Button';
import { resolveFilePresentation } from '../../lib/filePresentation';
import { pathFileName } from '../../lib/pathDisplay';

const TEXT_CHAR_LIMIT = 250_000;
const HIGHLIGHT_CHAR_LIMIT = 120_000;
const TABLE_ROW_LIMIT = 500;
const TABLE_COL_LIMIT = 50;
const PDF_RENDER_SCALE = 1.4;

interface FilePreviewPaneProps {
  accessToken: string;
  relative: string;
  onOpenExternal: () => void;
  onReveal: () => void;
}

type PreviewState =
  | { accessToken: string; relative: string; kind: 'error'; message: string }
  | { accessToken: string; relative: string; kind: 'ready'; payload: FilePreviewPayload };

export function normalizePreviewBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (Array.isArray(data)) return new Uint8Array(data);
  if (data && typeof data === 'object') {
    const obj = data as { data?: unknown };
    if (Array.isArray(obj.data)) return new Uint8Array(obj.data as number[]);
  }
  return new Uint8Array(0);
}

function formatBytes(n: number): string {
  if (n < 1024) return `${String(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return '';
  return base.slice(dot + 1).toLowerCase();
}

export const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
const TABULAR_EXTENSIONS = new Set(['csv', 'tsv']);

export function FilePreviewPane({
  accessToken,
  relative,
  onOpenExternal,
  onReveal,
}: FilePreviewPaneProps) {
  const [state, setState] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!accessToken || !relative) return;
    let cancelled = false;
    readFilePreview(accessToken, relative)
      .then((payload) => {
        if (!cancelled) setState({ accessToken, relative, kind: 'ready', payload });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            accessToken,
            relative,
            kind: 'error',
            message: previewErrorMessage(err),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accessToken, relative]);

  if (!relative) {
    return (
      <PreviewFrame>
        <div className="flex h-full items-center justify-center px-6 text-center text-body text-muted">
          Select a file to preview.
        </div>
      </PreviewFrame>
    );
  }

  // A result belongs to the path it was read for. While the next file loads,
  // the previous one stays up under its own name (never the new file's, which
  // would flash a Markdown file's text as source), and a busy chip appears if
  // the wait is long enough to notice.
  const shown = state?.accessToken === accessToken ? state : null;
  const isLoading = shown?.relative !== relative;
  if (!shown || (isLoading && shown.kind === 'error')) {
    return (
      <PreviewFrame>
        <PreviewLoading label="Loading preview…" />
      </PreviewFrame>
    );
  }
  if (shown.kind === 'error') {
    return (
      <PreviewFrame>
        <PreviewProblem
          title={`Couldn't preview ${pathFileName(relative)}`}
          detail={shown.message}
        >
          <Button size="sm" icon={ExternalLink} className="mt-2" onClick={onOpenExternal}>
            Open externally
          </Button>
        </PreviewProblem>
      </PreviewFrame>
    );
  }
  return (
    <PreviewFrame>
      <PreviewBody
        key={shown.relative}
        payload={shown.payload}
        fileName={pathFileName(shown.relative)}
        onOpenExternal={onOpenExternal}
        onReveal={onReveal}
      />
      {isLoading && <PreviewBusyChip label="Loading…" />}
    </PreviewFrame>
  );
}

function PreviewFrame({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
    </section>
  );
}

// IPC rejections arrive wrapped as "Error invoking remote method '…': Error: …".
function previewErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
}

function PreviewBody({
  payload,
  fileName,
  onOpenExternal,
  onReveal,
}: {
  payload: FilePreviewPayload;
  fileName: string;
  onOpenExternal: () => void;
  onReveal: () => void;
}) {
  if (payload.oversize || !payload.previewable) {
    return <FallbackNotice payload={payload} onOpenExternal={onOpenExternal} onReveal={onReveal} />;
  }

  switch (payload.category) {
    case 'text':
      return <TextPreview text={payload.text ?? ''} fileName={fileName} />;
    case 'image':
      return <ImagePreview data={payload.data} fileName={fileName} />;
    case 'pdf':
      return <PdfPreview data={payload.data} />;
    case 'docx':
      return <DocxPreview data={payload.data} />;
    case 'xlsx':
      return <XlsxPreview data={payload.data} />;
    default:
      return (
        <FallbackNotice payload={payload} onOpenExternal={onOpenExternal} onReveal={onReveal} />
      );
  }
}

function FallbackNotice({
  payload,
  onOpenExternal,
  onReveal,
}: {
  payload: FilePreviewPayload;
  onOpenExternal: () => void;
  onReveal: () => void;
}) {
  const oversize = payload.oversize;
  const reason = payload.reason ?? (oversize ? 'File exceeds the inline preview size cap.' : null);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <AlertTriangle className={`size-icon-lg ${oversize ? 'text-warning' : 'text-muted'}`} />
      <div className="space-y-1">
        <p className="text-subheading text-primary">
          {oversize ? 'File too large to preview inline' : 'No inline preview available'}
        </p>
        {reason && <p className="max-w-sm text-body text-muted">{reason}</p>}
        {payload.totalSize > 0 && (
          <p className="text-caption tabular-nums text-muted">
            {formatBytes(payload.totalSize)} · cap {formatBytes(payload.sizeCapBytes)}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button icon={ExternalLink} onClick={onOpenExternal}>
          Open externally
        </Button>
        <Button variant="ghost" icon={FolderSearch} onClick={onReveal}>
          Reveal
        </Button>
      </div>
    </div>
  );
}

function TextPreview({ text, fileName }: { text: string; fileName: string }) {
  const ext = extensionOf(fileName);
  const isMarkdown = MARKDOWN_EXTENSIONS.has(ext);
  const isTabular = TABULAR_EXTENSIONS.has(ext);

  const truncated = text.length > TEXT_CHAR_LIMIT;
  const visibleText = truncated ? text.slice(0, TEXT_CHAR_LIMIT) : text;

  if (isTabular) {
    return (
      <CsvPreview
        text={visibleText}
        delimiter={ext === 'tsv' ? '\t' : ','}
        truncated={truncated}
        originalLength={text.length}
      />
    );
  }

  return (
    <div className="h-full overflow-auto">
      {truncated && (
        <div className="sticky top-0 z-10 bg-surface/80 px-3 py-1.5 text-caption text-warning backdrop-blur">
          Showing first {formatBytes(visibleText.length)} of {formatBytes(text.length)} (truncated
          for performance).
        </div>
      )}
      {isMarkdown ? (
        <div className="mx-auto min-w-0 max-w-2xl px-6 py-5">
          <Markdown allowGeneratedContent={false}>{visibleText}</Markdown>
        </div>
      ) : (
        <SyntaxCodePreview code={visibleText} fileName={fileName} />
      )}
    </div>
  );
}

function SyntaxCodePreview({ code, fileName }: { code: string; fileName: string }) {
  const language = resolveFilePresentation(fileName).language;
  if (!language || code.length > HIGHLIGHT_CHAR_LIMIT) {
    return (
      <pre className="px-4 py-3 font-mono text-code text-secondary">
        <code className="whitespace-pre-wrap break-all">{code}</code>
      </pre>
    );
  }

  return (
    <Highlight theme={CODE_THEME} code={code} language={language}>
      {({ tokens, getLineProps, getTokenProps, className, style }) => (
        <pre
          className={`${className} min-w-0 px-2 py-3 font-mono text-code`}
          style={{ ...style, background: 'transparent' }}
        >
          {tokens.map((line, lineIndex) => {
            const lineProps = getLineProps({ line });
            return (
              <div {...lineProps} key={lineIndex} className={`${lineProps.className} flex min-w-0`}>
                <span className="w-9 shrink-0 select-none pr-3 text-right text-muted/50">
                  {lineIndex + 1}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                  {line.map((token, tokenIndex) => (
                    <span {...getTokenProps({ token })} key={tokenIndex} />
                  ))}
                </span>
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
}

function CsvPreview({
  text,
  delimiter,
  truncated,
  originalLength,
}: {
  text: string;
  delimiter: string;
  truncated: boolean;
  originalLength: number;
}) {
  const rows = useMemo(
    () => parseDelimitedText(text, delimiter, TABLE_ROW_LIMIT, TABLE_COL_LIMIT),
    [text, delimiter],
  );
  return (
    <div className="flex h-full flex-col overflow-hidden">
      {truncated && (
        <div className="shrink-0 bg-surface px-3 py-1.5 text-caption text-warning">
          Showing first {formatBytes(text.length)} of {formatBytes(originalLength)} (truncated for
          performance).
        </div>
      )}
      <PreviewTable rows={rows} />
      {(rows.length >= TABLE_ROW_LIMIT ||
        (rows[rows.length - 1]?.length ?? 0) >= TABLE_COL_LIMIT) && (
        <div className="shrink-0 bg-surface px-3 py-1 text-caption text-muted">
          Limited to {TABLE_ROW_LIMIT} rows × {TABLE_COL_LIMIT} columns.
        </div>
      )}
    </div>
  );
}

function PreviewTable({ rows }: { rows: string[][] }) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table
        // eslint-disable-next-line design-policy/design-tokens -- dense-row divide-y: table rows draw their divider only in the collapsed border model
        className="w-full border-collapse text-caption"
      >
        <tbody className="divide-y divide-divider">
          {rows.map((row, rIdx) => (
            <tr key={rIdx} className={rIdx === 0 ? 'bg-elevated/40 font-medium' : ''}>
              {row.map((cell, cIdx) => (
                <td key={cIdx} className="break-words px-2 py-1 text-secondary">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ImagePreview({ data, fileName }: { data?: Uint8Array; fileName: string }) {
  const bytes = useMemo(() => normalizePreviewBytes(data), [data]);
  const [url, setUrl] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    setUrl('');
    setStatus('loading');
    if (!bytes.length) {
      setStatus('error');
      return;
    }
    const blobUrl = URL.createObjectURL(
      new Blob([bytes as unknown as BlobPart], { type: imageMimeType(fileName) }),
    );
    setUrl(blobUrl);
    return () => {
      URL.revokeObjectURL(blobUrl);
    };
  }, [bytes, fileName]);
  if (status === 'error') {
    return <PreviewProblem title="Couldn't render this image" />;
  }
  if (!url) {
    return <PreviewLoading label="Loading image…" />;
  }
  return (
    <div className="relative flex h-full items-center justify-center p-4">
      {status === 'loading' && <PreviewBusyChip label="Decoding…" />}
      {/* The checkerboard sits behind the image only, where it shows transparency. */}
      <img
        src={url}
        alt={`Preview of ${fileName}`}
        className={`image-checkerboard max-h-full max-w-full rounded-md object-contain shadow-sm ${status === 'ready' ? 'motion-safe:animate-fade-in' : 'opacity-0'}`}
        onLoad={() => {
          setStatus('ready');
        }}
        onError={() => {
          setStatus('error');
        }}
      />
    </div>
  );
}

export function imageMimeType(fileName: string): string {
  switch (extensionOf(fileName)) {
    case 'svg':
      return 'image/svg+xml';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    case 'avif':
      return 'image/avif';
    case 'ico':
      return 'image/x-icon';
    default:
      return 'image/png';
  }
}

async function loadPdfjsImpl() {
  const pdfjsLib = await import('pdfjs-dist');
  const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline');
  pdfjsLib.GlobalWorkerOptions.workerPort = new workerModule.default();
  return pdfjsLib;
}

let pdfjsModulePromise: ReturnType<typeof loadPdfjsImpl> | null = null;
function loadPdfjs(): ReturnType<typeof loadPdfjsImpl> {
  pdfjsModulePromise ??= loadPdfjsImpl();
  return pdfjsModulePromise;
}

function PdfPreview({ data }: { data?: Uint8Array }) {
  const bytes = useMemo(() => normalizePreviewBytes(data), [data]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(0);
  const [error, setError] = useState('');
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    setPage(1);
    setNumPages(0);
    setError('');
    setRendering(true);
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    loadPdfDocumentForPreview(
      loadPdfjs,
      bytes,
      () => cancelled,
      (task) => {
        loadingTask = task;
      },
    )
      .then((doc) => {
        if (!doc) return;
        documentRef.current = doc;
        setNumPages(doc.numPages);
        setRendering(false);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      documentRef.current = null;
      void loadingTask?.destroy();
    };
  }, [bytes]);

  useEffect(() => {
    const doc = documentRef.current;
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
  }, [page, numPages]);

  if (error) {
    return <PreviewProblem title="Couldn't render this PDF" detail={error} />;
  }

  return (
    <div className="flex h-full flex-col items-center overflow-auto bg-surface/20 p-4">
      <canvas
        ref={canvasRef}
        className="max-h-full rounded-sm shadow-lg"
        style={{ maxHeight: 'calc(100% - 32px)' }}
      />
      {numPages > 1 && (
        <div className="mt-2 flex items-center gap-1 rounded-lg bg-elevated p-1">
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

function DocxPreview({ data }: { data?: Uint8Array }) {
  const bytes = useMemo(() => normalizePreviewBytes(data), [data]);
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
    const container = containerRef.current;
    const renderingDocument = document.implementation.createHTMLDocument('');
    const renderedBody = renderingDocument.createElement('div');
    const renderedStyles = renderingDocument.createElement('div');
    container.innerHTML = '';
    setLoading(true);
    setError('');
    import('docx-preview')
      .then(({ renderAsync }) =>
        renderAsync(new Blob([bytes as unknown as BlobPart]), renderedBody, renderedStyles, {
          ...DOCX_PREVIEW_OPTIONS,
          h: createSanitizedDocxElementFactory(renderingDocument),
        }),
      )
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

type XlsxRow = string[];
interface XlsxSheet {
  sheet: string;
  data: XlsxRow[];
}

function XlsxPreview({ data }: { data?: Uint8Array }) {
  const bytes = useMemo(() => normalizePreviewBytes(data), [data]);
  const [sheets, setSheets] = useState<XlsxSheet[]>([]);
  const [activeSheet, setActiveSheet] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bytes.length) {
      setSheets([]);
      setError('');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    import('read-excel-file/browser')
      .then(({ default: readXlsx }) => readXlsx(new Blob([bytes as unknown as BlobPart])))
      .then((allSheets) => {
        if (cancelled) return;
        const trimmed: XlsxSheet[] = allSheets.map((sheet) => {
          const rows: XlsxRow[] = sheet.data.slice(0, TABLE_ROW_LIMIT).map((row) =>
            row.slice(0, TABLE_COL_LIMIT).map((cell): string => {
              if (cell === null) return '';
              if (cell instanceof Date) return cell.toISOString();
              if (typeof cell === 'boolean' || typeof cell === 'number') {
                return String(cell);
              }
              return String(cell);
            }),
          );
          return { sheet: sheet.sheet || 'Sheet', data: rows };
        });
        setSheets(trimmed);
        setActiveSheet(0);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [bytes]);

  if (loading) {
    return <PreviewLoading label="Parsing spreadsheet…" />;
  }

  if (error) {
    return <PreviewProblem title="Couldn't read this spreadsheet" detail={error} />;
  }

  if (!sheets.length) return null;
  const sheet = sheets[activeSheet];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {sheets.length > 1 && (
        <div className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto bg-surface px-2 py-1.5">
          {sheets.map((s, idx) => (
            <button
              key={s.sheet}
              type="button"
              onClick={() => {
                setActiveSheet(idx);
              }}
              className={`h-6 shrink-0 select-none rounded-sm px-2 text-label transition-colors ${
                idx === activeSheet
                  ? 'bg-active text-primary'
                  : 'text-muted hover:bg-elevated hover:text-primary'
              }`}
            >
              {s.sheet}
            </button>
          ))}
        </div>
      )}
      <PreviewTable rows={sheet.data} />
      <div className="shrink-0 bg-surface px-3 py-1 text-caption text-muted">
        Limited to {TABLE_ROW_LIMIT} rows × {TABLE_COL_LIMIT} columns per sheet.
      </div>
    </div>
  );
}

// Most previews arrive within a frame or two; a loading indicator waits before
// it fades in, so a quick open goes straight from one file to the next.
const LOADING_REVEAL_DELAY = { animationDelay: '200ms', animationFillMode: 'both' } as const;

function PreviewLoading({ label }: { label: string }) {
  return (
    <div
      className="flex h-full items-center justify-center gap-2 text-body text-muted motion-safe:animate-fade-in"
      style={LOADING_REVEAL_DELAY}
    >
      <Spinner className="size-icon-md motion-safe:animate-spin-slow" />
      {label}
    </div>
  );
}

function PreviewBusyChip({ label }: { label: string }) {
  return (
    <div
      className="absolute right-3 top-3 flex items-center gap-1.5 rounded-sm bg-raised px-2 py-1 text-caption text-muted shadow-sm motion-safe:animate-fade-in"
      style={LOADING_REVEAL_DELAY}
    >
      <Spinner className="size-3 motion-safe:animate-spin-slow" />
      {label}
    </div>
  );
}

function PreviewProblem({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <AlertTriangle className="size-icon-lg text-warning" />
      <p className="max-w-sm text-subheading text-primary">{title}</p>
      {detail && <p className="max-w-sm break-words text-body text-muted">{detail}</p>}
      {children}
    </div>
  );
}
