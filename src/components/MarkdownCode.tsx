import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Copy, WrapText } from '@droidex/icons';
import { Button } from './ui/Button';
import { Tooltip } from './ui/Tooltip';

const LANGUAGE_LABELS: Record<string, string> = {
  sh: 'Bash',
  shell: 'Bash',
  bash: 'Bash',
  zsh: 'Bash',
  console: 'Bash',
  shellsession: 'Bash',
  js: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  tsx: 'TSX',
  py: 'Python',
  rb: 'Ruby',
  rs: 'Rust',
  yml: 'YAML',
  yaml: 'YAML',
  md: 'Markdown',
};

function languageLabel(className?: string): string {
  const match = className?.match(/lang(?:uage)?-([\w+#.-]+)/i);
  if (!match) return 'Code';
  const language = match[1].toLowerCase();
  return LANGUAGE_LABELS[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

export async function copyMarkdownCode(
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
  text: string,
): Promise<boolean> {
  if (!clipboard) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function CardHeader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-8 select-none items-center justify-between gap-2 pl-3.5 pr-1.5">
      <span className="truncate text-label text-muted">{label}</span>
      <div className="flex shrink-0 items-center gap-0.5">{children}</div>
    </div>
  );
}

export function CodeCopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      clearTimeout(timer.current ?? undefined);
    },
    [],
  );
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={copied ? Check : Copy}
      aria-live="polite"
      onClick={() => {
        void copyMarkdownCode(navigator.clipboard, text).then((didCopy) => {
          if (!didCopy) return;
          setCopied(true);
          clearTimeout(timer.current ?? undefined);
          timer.current = setTimeout(() => {
            setCopied(false);
          }, 1200);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </Button>
  );
}

/* ── Token highlighting ──
   Per-token spans are fine for a snippet and a long task for a dumped payload. */
export const HIGHLIGHT_MAX_CHARS = 8_192;

// Prism and its grammars stay out of the startup bundle. The plain text holds
// the same glyphs as the tokens, so highlighting lands without a layout shift.
const PrismCode = lazy(() => import('./PrismCode'));

/** The highlighted body for a fence, or undefined when it stays plain text. */
export function highlightFence(className: string | undefined, code: string): ReactNode {
  if (code.length > HIGHLIGHT_MAX_CHARS) return undefined;
  const language = className?.match(/language-([\w+#.-]+)/)?.[1].toLowerCase();
  if (!language) return undefined;
  if (language === 'json') return <HighlightJson code={code} />;
  // An SVG fence only reaches a code card when it was refused as an image, and
  // then it stays verbatim, escaped source.
  if (language === 'svg') return undefined;
  return (
    <Suspense fallback={code}>
      <PrismCode code={code} language={language} />
    </Suspense>
  );
}

function HighlightJson({ code }: { code: string }) {
  const nodes = useMemo(() => {
    const tokens = code.split(
      /("(?:\\.|[^"\\])*"|:|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[[\]{}!,])/g,
    );
    return tokens.map((token, i) => {
      if (/^"(?:\\.|[^"\\])*"$/.exec(token)) {
        // Captures alternate with the text between them, so the colon that
        // makes this a key is two tokens on, across (at most) whitespace.
        if (tokens[i + 1].trim() === '' && tokens[i + 2] === ':') {
          return (
            <span key={i} style={{ color: 'var(--accent)' }}>
              {token}
            </span>
          );
        }
        return (
          <span key={i} style={{ color: 'var(--success)' }}>
            {token}
          </span>
        );
      }
      if (token === 'true' || token === 'false')
        return (
          <span key={i} style={{ color: 'var(--warning)' }}>
            {token}
          </span>
        );
      if (token === 'null')
        return (
          <span key={i} style={{ color: 'var(--text-muted)' }}>
            {token}
          </span>
        );
      if (/^-?\d/.exec(token))
        return (
          <span key={i} style={{ color: 'var(--warning)' }}>
            {token}
          </span>
        );
      if (/^[{}[\],:!]$/.test(token))
        return (
          <span key={i} style={{ color: 'var(--text-muted)' }}>
            {token}
          </span>
        );
      return <span key={i}>{token}</span>;
    });
  }, [code]);

  return <>{nodes}</>;
}

/* ── Code card chrome ──
   The reader controls the frame: copy stays, soft-wrap tames long lines at the
   cost of the gutter, and blocks past COLLAPSE_LINE_THRESHOLD lines start
   folded so one giant dump stops eating the transcript. The card separates from
   the prose by tone alone, so it never draws a box inside a message. */

const COLLAPSE_LINE_THRESHOLD = 24;
const COLLAPSED_LINES = 12;
// Numbers earn their place once a block is long enough to be scrolled.
const GUTTER_MIN_LINES = 4;
// Matches the `code` type style's 1.5 leading, so the fold cuts between lines.
const CODE_LINE_HEIGHT = 1.5;

function LineGutter({ count }: { count: number }) {
  return (
    <div
      aria-hidden
      className="mr-4 shrink-0 select-none text-right font-mono text-code text-muted"
    >
      {Array.from({ length: count }, (_, i) => (
        <div key={i}>{i + 1}</div>
      ))}
    </div>
  );
}

function CodeCardControls({
  collapsible,
  collapsed,
  wrapped,
  onToggleCollapse,
  onToggleWrap,
  code,
}: {
  collapsible: boolean;
  collapsed: boolean;
  wrapped: boolean;
  onToggleCollapse: () => void;
  onToggleWrap: () => void;
  code: string;
}) {
  return (
    <>
      {collapsible && (
        <Button variant="ghost" size="sm" onClick={onToggleCollapse} aria-expanded={!collapsed}>
          {collapsed ? 'Show all' : 'Collapse'}
        </Button>
      )}
      <Tooltip label={wrapped ? 'Disable soft wrap' : 'Soft wrap long lines'}>
        <Button
          variant="ghost"
          size="sm"
          icon={WrapText}
          onClick={onToggleWrap}
          aria-label="Soft wrap long lines"
          aria-pressed={wrapped}
        />
      </Tooltip>
      <CodeCopyButton text={code} />
    </>
  );
}

export function CodeCard({
  code,
  className,
  specMode,
  highlighted,
}: {
  code: string;
  className?: string;
  specMode?: boolean;
  highlighted?: ReactNode;
}) {
  const [wrapped, setWrapped] = useState(false);
  const lines = useMemo(() => code.split('\n'), [code]);
  const collapsible = lines.length > COLLAPSE_LINE_THRESHOLD;
  // Decided at mount only: a fence that streams past the threshold keeps the
  // reader's expanded view instead of folding under their hands.
  const [collapsed, setCollapsed] = useState(() => collapsible);
  const showGutter = !wrapped && !collapsed && lines.length >= GUTTER_MIN_LINES;
  // The added 0.25rem is the <pre>'s top padding (pt-1).
  const collapsedMaxHeight = `calc(var(--code-font-size) * ${String(CODE_LINE_HEIGHT * COLLAPSED_LINES)} + 0.25rem)`;

  return (
    <div className={`overflow-hidden rounded-lg bg-elevated/50 ${specMode ? 'my-4' : 'my-2.5'}`}>
      <CardHeader label={languageLabel(className)}>
        <CodeCardControls
          collapsible={collapsible}
          collapsed={collapsed}
          wrapped={wrapped}
          onToggleCollapse={() => {
            setCollapsed((v) => !v);
          }}
          onToggleWrap={() => {
            setWrapped((v) => !v);
          }}
          code={code}
        />
      </CardHeader>
      <div className="relative">
        {/* The fold fades out through a mask, so it blends into whatever tone
            the card sits on instead of painting a gradient of its own. */}
        <div
          className={
            collapsed ? '[mask-image:linear-gradient(to_bottom,#000_45%,transparent)]' : undefined
          }
        >
          <pre
            className={`scrollbar-on-hover scroll-fade-x flex overflow-x-auto px-4 pt-1 ${specMode ? 'pb-4' : 'pb-3.5'}`}
            style={collapsed ? { maxHeight: collapsedMaxHeight, overflowY: 'hidden' } : undefined}
          >
            {showGutter && <LineGutter count={lines.length} />}
            <code
              className={`font-mono text-code text-primary ${wrapped ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'}`}
            >
              {highlighted ?? code}
            </code>
          </pre>
        </div>
        {collapsed && (
          <div className="absolute inset-x-0 bottom-2.5 flex justify-center">
            <Button
              size="sm"
              shape="round"
              icon={ChevronDown}
              onClick={() => {
                setCollapsed(false);
              }}
              aria-expanded={false}
            >
              Show all {String(lines.length)} lines
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
