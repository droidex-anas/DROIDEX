import { useEffect, useState } from 'react';
import { PreviewLoading, PreviewProblem } from './PreviewStatus';
import { PreviewTable, TABLE_COL_LIMIT, TABLE_ROW_LIMIT } from './PreviewTable';

interface XlsxSheet {
  sheet: string;
  data: string[][];
}

export function XlsxPreview({ bytes }: { bytes: Uint8Array }) {
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
          const rows = sheet.data.slice(0, TABLE_ROW_LIMIT).map((row) =>
            row.slice(0, TABLE_COL_LIMIT).map((cell): string => {
              if (cell === null) return '';
              if (cell instanceof Date) return cell.toISOString();
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
