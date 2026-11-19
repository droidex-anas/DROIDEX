import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

/* ─────────────────────────────────────────────────────────────────────────
 * Rich <json-render> renderer.
 *
 * Agents emit a single-line JSON spec wrapped in <json-render>…</json-render>
 * tags to draw dashboards, charts, tables, etc. The spec shape is:
 *   { "root": "<id>", "elements": { "<id>": { type, props, children } } }
 * where `children` is an array of element-id strings.
 *
 * The renderer is intentionally lenient: models routinely place component
 * props as siblings of `type` instead of inside `props`, so we merge any
 * stray top-level keys into props before rendering.
 * ──────────────────────────────────────────────────────────────────────── */

const CELL = 8; // px per layout "cell" for padding/gap multipliers
const MAX_DEPTH = 50;
// Global expansion budget. `seen` only blocks cycles along a single ancestry
// path, so a shared-child DAG (a -> [b,b], b -> [c,c], ...) still fans out
// exponentially before MAX_DEPTH alone stops it. A shared node budget caps the
// total rendered elements so a small malicious/buggy spec can't freeze the UI.
const MAX_NODES = 1000;
// Collection props (chart data, table rows, list items) are capped before
// rendering: a huge array would not only spawn thousands of DOM nodes but can
// also blow the call stack via spread math like `Math.min(...data)` (a
// model-supplied `data` of 100k+ numbers throws RangeError and freezes chat).
const MAX_ITEMS = 2000;
const MAX_TABLE_COLUMNS = 40;

interface Spec {
  root: string;
  elements: Record<string, unknown>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSpec(value: unknown): value is Spec {
  return (
    isObject(value) &&
    typeof value.root === 'string' &&
    value.root !== '' &&
    isObject(value.elements)
  );
}

function parseSpec(source: string): Spec | null {
  try {
    const value: unknown = JSON.parse(source.trim());
    return isSpec(value) ? value : null;
  } catch {
    return null;
  }
}

const COLOR_MAP: Record<string, string> = {
  accent: 'var(--accent)',
  green: 'var(--success)',
  success: 'var(--success)',
  orange: 'var(--warning)',
  warning: 'var(--warning)',
  red: 'var(--danger)',
  error: 'var(--danger)',
  danger: 'var(--danger)',
  info: 'var(--accent)',
  blue: 'var(--accent)',
  muted: 'var(--text-muted)',
  secondary: 'var(--text-secondary)',
  text: 'var(--text)',
  white: 'var(--text)',
  gray: 'var(--text-muted)',
  grey: 'var(--text-muted)',
};

// Only allow our themed names plus literal hex/rgb/hsl/plain-word colors. This
// blocks CSS functions like url()/var()/image-set() from model-supplied specs
// from smuggling network requests or escaping the intended style.
const SAFE_COLOR_RE =
  /^(#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|rgba?\([\d.,\s%/]+\)|hsla?\([\d.,\s%/]+\)|[a-z]+)$/i;

function resolveColor(c: unknown): string | undefined {
  if (typeof c !== 'string' || !c) return undefined;
  const trimmed = c.trim();
  const mapped = COLOR_MAP[trimmed.toLowerCase()];
  if (mapped) return mapped;
  return SAFE_COLOR_RE.test(trimmed) ? trimmed : undefined;
}

function asString(v: unknown, fallback = ''): string {
  if (v == null) return fallback;
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return fallback;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v.slice(0, MAX_ITEMS) : [];
}

// Like asArray but drops entries that are not plain objects, so components can
// safely dereference fields (d.value, Object.keys(r), it.status) on specs that
// include null/primitive entries such as data: [null].
function asRecordArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v
        .filter((e): e is Record<string, unknown> => isObject(e) && !Array.isArray(e))
        .slice(0, MAX_ITEMS)
    : [];
}

/* Merge stray top-level keys into props so malformed specs still render. */
function mergedProps(el: Record<string, unknown>): Record<string, unknown> {
  const { type: _t, props, children: _c, ...rest } = el;
  void _t;
  void _c;
  return { ...rest, ...(isObject(props) ? props : {}) };
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
function statusColor(key: string, fallback = 'var(--text-muted)'): string {
  return Object.prototype.hasOwnProperty.call(STATUS_COLOR, key) ? STATUS_COLOR[key] : fallback;
}

/* ── individual components ── */

function BoxEl({
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

function TextEl({ text, color, bold }: { text: string; color?: string; bold: boolean }) {
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

function HeadingEl({ level, text }: { level: string; text: string }) {
  const cls = HEADING_CLASSES.get(level) ?? 'text-subheading';
  return <div className={`${cls} text-primary break-words`}>{text}</div>;
}

function DividerEl({ title }: { title: string }) {
  if (!title) return <div className="h-px bg-divider/70 my-1" />;
  return (
    <div className="flex items-center gap-2.5 my-1 text-muted">
      <div className="h-px flex-1 bg-divider/70" />
      <span className="text-caption whitespace-nowrap">{title}</span>
      <div className="h-px flex-1 bg-divider/70" />
    </div>
  );
}

function BarChartEl({
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

function SparklineEl({ data, color = 'var(--accent)' }: { data: number[]; color?: string }) {
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

function TableEl({
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

function ListEl({ items, ordered }: { items: string[]; ordered: boolean }) {
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

function CardEl({
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

function StatusLineEl({ status, text }: { status: string; text: string }) {
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

function KeyValueEl({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2 text-body">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 text-primary font-medium break-words">{value}</span>
    </div>
  );
}

function BadgeEl({ color = 'var(--text-secondary)', label }: { color?: string; label: string }) {
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

function ProgressBarEl({ progress = 0, label }: { progress?: number; label: string }) {
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

function MetricEl({ trend, label, value }: { trend: string; label: string; value: string }) {
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

function CalloutEl({
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

function TimelineEl({ items }: { items: { color: string; title: string; description: string }[] }) {
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

/* ── element dispatch ── */

function renderElement(
  type: string,
  props: Record<string, unknown>,
  children: ReactNode,
): ReactNode {
  switch (type) {
    case 'Box':
      return (
        <BoxEl
          row={props.flexDirection === 'row'}
          padding={asNumber(props.padding)}
          gap={asNumber(props.gap)}
          // A spec's borderStyle asks for a framed box; frames separate by tone, not outline.
          framed={!!props.borderStyle}
        >
          {children}
        </BoxEl>
      );
    case 'Text':
      return (
        <TextEl text={asString(props.text)} color={resolveColor(props.color)} bold={!!props.bold} />
      );
    case 'Heading':
      return (
        <HeadingEl level={asString(props.level, 'h2').toLowerCase()} text={asString(props.text)} />
      );
    case 'Divider':
      return <DividerEl title={asString(props.title)} />;
    case 'Newline':
      return <br />;
    case 'Spacer':
      return <div style={{ flex: 1 }} />;
    case 'BarChart':
      return (
        <BarChartEl
          data={asRecordArray(props.data).map((item) => ({
            label: asString(item.label),
            value: asNumber(item.value) ?? 0,
            color: resolveColor(item.color) ?? 'var(--accent)',
          }))}
          showPercentage={!!props.showPercentage}
        />
      );
    case 'Sparkline':
      return (
        <SparklineEl
          data={asArray(props.data).map((v) => asNumber(v) ?? 0)}
          color={resolveColor(props.color)}
        />
      );
    case 'Table':
      return (
        <TableEl
          columns={asRecordArray(props.columns)
            .slice(0, MAX_TABLE_COLUMNS)
            .map((column) => ({
              key: asString(column.key),
              header: asString(column.header ?? column.key),
              width: asNumber(column.width),
            }))}
          rows={asRecordArray(props.rows)}
          headerColor={resolveColor(props.headerColor)}
        />
      );
    case 'List':
      return (
        <ListEl items={asArray(props.items).map((v) => asString(v))} ordered={!!props.ordered} />
      );
    case 'Card':
      return (
        <CardEl title={asString(props.title)} padding={asNumber(props.padding)}>
          {children}
        </CardEl>
      );
    case 'StatusLine':
      return (
        <StatusLineEl
          status={asString(props.status, 'info').toLowerCase()}
          text={asString(props.text)}
        />
      );
    case 'KeyValue':
      return <KeyValueEl label={asString(props.label)} value={asString(props.value)} />;
    case 'Badge':
      return <BadgeEl color={resolveColor(props.variant)} label={asString(props.label)} />;
    case 'ProgressBar':
      return <ProgressBarEl progress={asNumber(props.progress)} label={asString(props.label)} />;
    case 'Metric':
      return (
        <MetricEl
          trend={asString(props.trend).toLowerCase()}
          label={asString(props.label)}
          value={asString(props.value)}
        />
      );
    case 'Callout':
      return (
        <CalloutEl
          status={asString(props.type, 'info').toLowerCase()}
          title={asString(props.title)}
          content={asString(props.content)}
        >
          {children}
        </CalloutEl>
      );
    case 'Timeline':
      return (
        <TimelineEl
          items={asRecordArray(props.items).map((item) => ({
            color: statusColor(asString(item.status).toLowerCase()),
            title: asString(item.title),
            description: asString(item.description),
          }))}
        />
      );
    default:
      return children ?? null;
  }
}

function renderNode(
  id: string,
  spec: Spec,
  seen: Set<string>,
  depth: number,
  budget: { count: number },
): ReactNode {
  if (depth > MAX_DEPTH || seen.has(id) || budget.count >= MAX_NODES) return null;
  budget.count++;
  const el = spec.elements[id];
  if (!isObject(el)) return null;
  const props = mergedProps(el);
  const childIds = asArray(el.children ?? props.children).filter(
    (c): c is string => typeof c === 'string',
  );
  const nextSeen = new Set(seen).add(id);
  const children = childIds.length
    ? childIds.map((cid, i) => (
        <Fragment key={`${cid}-${String(i)}`}>
          {renderNode(cid, spec, nextSeen, depth + 1, budget)}
        </Fragment>
      ))
    : null;
  return renderElement(asString(el.type), props, children);
}

function ErrorFallback({ raw }: { raw: string }) {
  return (
    <div className="rounded-lg bg-elevated/50 overflow-hidden my-2.5">
      <div className="px-3 pt-2.5 text-label text-muted">Render spec (unparseable)</div>
      <pre className="overflow-x-auto px-3 pb-2.5 pt-1.5">
        <code className="font-mono text-code text-secondary whitespace-pre">{raw}</code>
      </pre>
    </div>
  );
}

export const JsonRender = memo(function JsonRender({ source }: { source: string }) {
  const parsed = useMemo(() => parseSpec(source), [source]);

  if (!parsed) {
    return <ErrorFallback raw={source.trim()} />;
  }

  const tree = renderNode(parsed.root, parsed, new Set(), 0, { count: 0 });
  if (tree == null) return <ErrorFallback raw={source.trim()} />;

  return <div className="my-2.5 w-full max-w-full break-words">{tree}</div>;
});

/* ── splitting helper for message bodies ── */

export type ContentSegment =
  | { type: 'markdown'; value: string }
  | { type: 'json-render'; value: string };

const JSON_RENDER_RE = /<json-render>([\s\S]*?)<\/json-render>/g;

export function splitJsonRender(text: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  JSON_RENDER_RE.lastIndex = 0;
  while ((match = JSON_RENDER_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'markdown', value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: 'json-render', value: match[1] });
    lastIndex = match.index + match[0].length;
  }

  let tail = text.slice(lastIndex);
  // A still-streaming render has an opening tag without a close: hide the partial
  // JSON rather than dumping it as raw text, and keep any text before it. Only do
  // this when the tag is genuinely starting a render block (its JSON has begun);
  // a literal mention in prose like "use <json-render> tags" is kept as-is.
  const openIdx = tail.indexOf('<json-render>');
  if (openIdx !== -1) {
    const after = tail.slice(openIdx + '<json-render>'.length).trimStart();
    if (after.startsWith('{')) tail = tail.slice(0, openIdx);
  }
  if (tail) segments.push({ type: 'markdown', value: tail });

  return segments;
}

export function hasJsonRender(text: string): boolean {
  return text.includes('<json-render>');
}

export const __resolveColorForTest = resolveColor;
export const __statusColorForTest = statusColor;

// Test seam: render a spec and report how many nodes were actually expanded, so
// the global budget can be asserted without a DOM. Returns at most MAX_NODES.
export function __renderBudgetForTest(spec: Spec): number {
  const budget = { count: 0 };
  void renderNode(spec.root, spec, new Set(), 0, budget);
  return budget.count;
}
export const __MAX_NODES_FOR_TEST = MAX_NODES;
