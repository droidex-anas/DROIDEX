import { Fragment, memo, useMemo, type ReactNode } from 'react';
import {
  BoxEl,
  TextEl,
  HeadingEl,
  DividerEl,
  BarChartEl,
  SparklineEl,
  TableEl,
  ListEl,
  CardEl,
  StatusLineEl,
  KeyValueEl,
  BadgeEl,
  ProgressBarEl,
  MetricEl,
  CalloutEl,
  TimelineEl,
  MAX_TABLE_COLUMNS,
  asString,
  statusColor,
} from './JsonRenderElements';

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
