import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, ExternalLink, FolderSearch } from '@droidex/icons';
import { Highlight } from 'prism-react-renderer';
import { readFilePreview } from '../../lib/desktop';
import type { FilePreviewPayload } from '../../lib/desktopContract';
import { resolveFilePresentation } from '../../lib/filePresentation';
import { parseDelimitedText } from '../../lib/filePreview';
import { pathFileName } from '../../lib/pathDisplay';
import { Markdown } from '../Markdown';
import { CODE_THEME, HIGHLIGHT_CHAR_LIMIT } from '../codeTheme';
import { Button } from '../ui/Button';
import { DocxPreview } from './DocxPreview';
import { PdfPreview } from './PdfPreview';
import { PreviewBusyChip, PreviewLoading, PreviewProblem } from './PreviewStatus';
import { PreviewTable, TABLE_COL_LIMIT, TABLE_ROW_LIMIT } from './PreviewTable';
import { XlsxPreview } from './XlsxPreview';

const TEXT_CHAR_LIMIT = 250_000;

interface FilePreviewPaneProps {
  accessToken: string;
  relative: string;
  refreshGeneration?: number;
  onOpenExternal: () => void;
  onReveal: () => void;
}

type PreviewState =
  | { accessToken: string; relative: string; kind: 'error'; message: string }
  | {
      accessToken: string;
      relative: string;
      kind: 'ready';
      payload: FilePreviewPayload;
    };

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
  refreshGeneration = 0,
  onOpenExternal,
  onReveal,
}: FilePreviewPaneProps) {
  const [state, setState] = useState<PreviewState | null>(null);

  useEffect(() => {
    if (!accessToken || !relative) return;
    let cancelled = false;
    readFilePreview(accessToken, relative)
      .then((payload) => {
        if (!cancelled) {
          setState((previous) => {
            if (
              previous?.kind === 'ready' &&
              previous.accessToken === accessToken &&
              previous.relative === relative &&
              samePreviewPayload(previous.payload, payload)
            )
              return previous;
            return {
              accessToken,
              relative,
              kind: 'ready',
              payload,
            };
          });
        }
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
  }, [accessToken, relative, refreshGeneration]);

  if (!relative) {
    return (
      <PreviewFrame>
        <div className="flex h-full items-center justify-center px-6 text-center text-body text-muted">
          Select a file to preview.
        </div>
      </PreviewFrame>
    );
  }

  // A result belongs to the path it was read for. Until the selected file's
  // result arrives the pane shows the loading state, never the previous file:
  // the header, breadcrumbs and actions around the pane already name the new
  // one, and rendering old text under a new name flashed Markdown as source.
  const current = state?.accessToken === accessToken && state.relative === relative ? state : null;
  if (!current) {
    return (
      <PreviewFrame>
        <PreviewLoading label="Loading preview…" />
      </PreviewFrame>
    );
  }
  if (current.kind === 'error') {
    return (
      <PreviewFrame>
        <PreviewProblem
          title={`Couldn't preview ${pathFileName(relative)}`}
          detail={current.message}
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
        key={JSON.stringify([accessToken, relative])}
        payload={current.payload}
        fileName={pathFileName(relative)}
        onOpenExternal={onOpenExternal}
        onReveal={onReveal}
      />
    </PreviewFrame>
  );
}

function samePreviewPayload(left: FilePreviewPayload, right: FilePreviewPayload): boolean {
  return (
    (left.data === right.data ||
      (left.encoding === 'binary' &&
        right.encoding === 'binary' &&
        left.mtimeMs === right.mtimeMs &&
        left.totalSize === right.totalSize)) &&
    JSON.stringify({ ...left, data: undefined }) === JSON.stringify({ ...right, data: undefined })
  );
}

function PreviewFrame({ children }: { children: ReactNode }) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg">
      <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
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
  const canPreview = payload.previewable && !payload.oversize;
  const data = canPreview ? payload.data : undefined;
  const bytes = useMemo(() => normalizePreviewBytes(data), [data]);

  if (!canPreview) {
    return <FallbackNotice payload={payload} onOpenExternal={onOpenExternal} onReveal={onReveal} />;
  }

  switch (payload.category) {
    case 'text':
      return <TextPreview text={payload.text ?? ''} fileName={fileName} />;
    case 'image':
      return <ImagePreview bytes={bytes} fileName={fileName} />;
    case 'pdf':
      return <PdfPreview bytes={bytes} />;
    case 'docx':
      return <DocxPreview bytes={bytes} />;
    case 'xlsx':
      return <XlsxPreview bytes={bytes} />;
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

function ImagePreview({ bytes, fileName }: { bytes: Uint8Array; fileName: string }) {
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
