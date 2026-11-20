import { type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

const CELL = 8; // px per layout "cell" for padding/gap multipliers
export const MAX_TABLE_COLUMNS = 40;

export function asString(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

// Semantic status → themed color. success/warning/error use the fixed semantic
// green/amber/red so they always read by hue, even in monochrome; only info
// follows the neutral accent so it stays part of the monochrome UI chrome.
const STATUS_COLOR: Record<string, string> = {
  success: 'var(--success)',
  error: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--accent)',
};

// Look up by own-property only: a model-supplied status like "constructor" or
// "toString" would otherwise resolve through Object.prototype to a truthy value
// and slip past the map, so guard against prototype keys explicitly.
export function statusColor(key: string, fallback = 'var(--text-muted)'): string {
  return Object.prototype.hasOwnProperty.call(STATUS_COLOR, key) ? STATUS_COLOR[key] : fallback;
}

export function BoxEl({
  row,
  padding,
  gap,
  framed,
  children,
}: {
  row: boolean;
  padding?: number;
  gap?: number;
  framed: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={framed ? 'rounded-lg bg-elevated/50' : undefined}
      style={{
        display: 'flex',
        flexDirection: row ? 'row' : 'column',
        flexWrap: row ? 'wrap' : undefined,
        alignItems: row ? 'stretch' : undefined,
        gap: gap != null ? gap * CELL : undefined,
        padding: padding != null ? padding * CELL : undefined,
      }}
    >
      {children}
    </div>
  );
}

export function TextEl({ text, color, bold }: { text: string; color?: string; bold: boolean }) {
  return (
    <span className="text-body break-words" style={{ color, fontWeight: bold ? 600 : undefined }}>
      {text}
    </span>
  );
}

const HEADING_CLASSES = new Map([
  ['h1', 'text-heading'],
  ['h3', 'text-body-strong text-secondary'],
]);

export function HeadingEl({ level, text }: { level: string; text: string }) {
  const cls = HEADING_CLASSES.get(level) ?? 'text-subheading';
  return <div className={`${cls} text-primary break-words`}>{text}</div>;
}

export function DividerEl({ title }: { title: string }) {
  if (!title) return <div className="h-px bg-divider/70 my-1" />;
  return (
    <div className="flex items-center gap-2.5 my-1 text-muted">
      <div className="h-px flex-1 bg-divider/70" />
      <span className="text-caption whitespace-nowrap">{title}</span>
      <div className="h-px flex-1 bg-divider/70" />
    </div>
  );
}

export function BarChartEl({
  data,
  showPercentage,
}: {
  data: { value: number; color: string; label: string }[];
  showPercentage: boolean;
}) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {data.map(({ value, color, label }, i) => {
        const displayValue = showPercentage
          ? `${String(Math.round((value / total) * 100))}%`
          : String(value);
        return (
          <div key={i} className="flex items-center gap-2 text-caption">
            <span className="w-24 shrink-0 truncate text-secondary text-right">{label}</span>
            <div className="flex-1 h-3.5 rounded-xs bg-elevated/60 overflow-hidden">
              <div
                className="h-full rounded-xs"
                style={{ width: `${String((value / max) * 100)}%`, backgroundColor: color }}
              />
            </div>
            <span className="w-12 shrink-0 tabular-nums text-muted">{displayValue}</span>
          </div>
        );
      })}
    </div>
  );
}

export function SparklineEl({ data, color = 'var(--accent)' }: { data: number[]; color?: string }) {
  const min = Math.min(...data, 0);
  const max = Math.max(...data, 1);
  const span = max - min || 1;
  return (
    <div className="inline-flex items-end gap-px h-6 align-middle">
      {data.map((v, i) => (
        <div
          key={i}
          className="w-1 rounded-xs"
          style={{
            height: `${String(Math.max(8, ((v - min) / span) * 100))}%`,
            backgroundColor: color,
          }}
        />
      ))}
    </div>
  );
}

export function TableEl({
  columns,
  rows,
  headerColor = 'var(--text)',
}: {
  columns: { key: string; header: string; width?: number }[];
  rows: Record<string, unknown>[];
  headerColor?: string;
}) {
  // Fall back to row keys when columns are omitted.
  const cols: typeof columns = columns.length
    ? columns
    : Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
        .slice(0, MAX_TABLE_COLUMNS)
        .map((key) => ({ header: key, key }));
  return (
    <div className="overflow-x-auto rounded-lg bg-surface w-full">
      {/* Row dividers only draw on <tr> when borders collapse. */}
      <table className="w-full text-body" style={{ borderCollapse: 'collapse' }}>
        <thead className="bg-elevated">
          <tr>
            {cols.map((c, i) => (
              <th
                key={i}
                className="text-left align-top text-body-strong whitespace-nowrap px-2.5 py-1.5"
                style={{ color: headerColor, width: c.width }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {rows.map((r, ri) => (
            <tr key={ri}>
              {cols.map((c, ci) => (
                <td
                  key={ci}
                  className="align-top text-secondary first:whitespace-nowrap first:pr-4 first:font-medium first:text-primary px-2.5 py-1.5"
                >
                  {asString(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ListEl({ items, ordered }: { items: string[]; ordered: boolean }) {
  const cls = 'marker:text-muted pl-5 space-y-1 text-body text-primary';
  return ordered ? (
    <ol className={`list-decimal ${cls}`}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ol>
  ) : (
    <ul className={`list-disc ${cls}`}>
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export function CardEl({
  title,
  padding = 1.5,
  children,
}: {
  title: string;
  padding?: number;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface overflow-hidden w-full">
      {title && <div className="px-3 pt-3 text-label text-primary">{title}</div>}
      <div style={{ padding: padding * CELL }}>{children}</div>
    </div>
  );
}

export function StatusLineEl({ status, text }: { status: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-body text-primary">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ background: statusColor(status) }}
      />
      {text}
    </span>
  );
}

export function KeyValueEl({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-body">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-primary font-medium break-words">{value}</span>
    </div>
  );
}

export function BadgeEl({
  color = 'var(--text-secondary)',
  label,
}: {
  color?: string;
  label: string;
}) {
  return (
    <span
      className="inline-flex h-5 items-center px-2 rounded-full text-caption font-medium"
      style={{
        color,
        background: `color-mix(in srgb, ${color} 12%, transparent)`,
      }}
    >
      {label}
    </span>
  );
}

export function ProgressBarEl({ progress = 0, label }: { progress?: number; label: string }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <div className="flex flex-col gap-1 w-full">
      {label && (
        <div className="flex justify-between text-caption text-secondary">
          <span>{label}</span>
          <span className="tabular-nums text-muted">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-2 rounded-full bg-elevated/60 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${String(pct)}%`, background: 'var(--accent)' }}
        />
      </div>
    </div>
  );
}

const METRIC_TRENDS = new Map([
  ['up', { color: 'var(--success)', icon: ArrowUp }],
  ['down', { color: 'var(--danger)', icon: ArrowDown }],
]);

export function MetricEl({ trend, label, value }: { trend: string; label: string; value: string }) {
  const trendStyle = METRIC_TRENDS.get(trend);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-caption text-muted">{label}</span>
      <span className="inline-flex items-center gap-1 text-heading tabular-nums text-primary">
        {value}
        {trendStyle && <trendStyle.icon className="w-4 h-4" style={{ color: trendStyle.color }} />}
      </span>
    </div>
  );
}

export function CalloutEl({
  status,
  title,
  content,
  children,
}: {
  status: string;
  title: string;
  content: string;
  children: ReactNode;
}) {
  const color = statusColor(status);
  // A single colored dot carries the severity; the card itself is a plain
  // elevated surface so P-level/danger notes read as clean cards, not stickers.
  return (
    <div className="w-full rounded-lg bg-elevated px-4 py-3">
      {title && (
        <div className="flex items-center gap-2 text-body-strong text-primary break-words">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
          {title}
        </div>
      )}
      {content && (
        <div
          className={`flex gap-2 text-body text-secondary break-words ${title ? 'mt-1.5 pl-3.5' : ''}`}
        >
          {!title && (
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: color }}
            />
          )}
          {content}
        </div>
      )}
      {children && <div className={title ? 'mt-1.5 pl-3.5' : ''}>{children}</div>}
    </div>
  );
}

export function TimelineEl({
  items,
}: {
  items: { color: string; title: string; description: string }[];
}) {
  return (
    <div className="flex flex-col">
      {items.map(({ color, title, description }, i) => {
        const last = i === items.length - 1;
        return (
          <div key={i} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <span className="mt-1 w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              {!last && <span className="w-px flex-1 bg-muted/30 my-1" />}
            </div>
            <div className={`flex flex-col gap-0.5 ${last ? '' : 'pb-3'}`}>
              <span className="text-body-strong text-primary">{title}</span>
              {description && <span className="text-caption text-secondary">{description}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
