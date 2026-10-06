import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { Copy, WrapText } from '@droidex/icons';

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

// One look for every control in a code or diagram card header: a quiet label
// that gains a soft tint under the pointer or keyboard focus.
export const CARD_CONTROL_CLASS =
  'flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-droid-text-muted transition-colors duration-150 hover:bg-droid-active hover:text-droid-text focus-visible:bg-droid-active focus-visible:text-droid-text focus-visible:outline-none disabled:pointer-events-none disabled:opacity-40';

export function CardHeader({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex h-8 items-center justify-between gap-2 pl-3.5 pr-1.5">
      <span className="truncate text-[11.5px] font-medium text-droid-text-muted">{label}</span>
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
    <button
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
      className={CARD_CONTROL_CLASS}
      title="Copy"
    >
      {copied ? <Check className="h-3 w-3 text-droid-green" /> : <Copy className="h-3 w-3" />}
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/* ── JSON token highlighting ──
   Per-token spans are fine for a snippet and a long task for a dumped payload. */
export const JSON_HIGHLIGHT_MAX_CHARS = 8_192;

export function HighlightJson({ code }: { code: string }) {
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
            <span key={i} style={{ color: 'var(--droid-accent)' }}>
              {token}
            </span>
          );
        }
        return (
          <span key={i} style={{ color: 'var(--droid-green)' }}>
            {token}
          </span>
        );
      }
      if (token === 'true' || token === 'false')
        return (
          <span key={i} style={{ color: 'var(--droid-orange)' }}>
            {token}
          </span>
        );
      if (token === 'null')
        return (
          <span key={i} style={{ color: 'var(--droid-text-muted)' }}>
            {token}
          </span>
        );
      if (/^-?\d/.exec(token))
        return (
          <span key={i} style={{ color: 'var(--droid-orange)' }}>
            {token}
          </span>
        );
      if (/^[{}[\],:!]$/.test(token))
        return (
          <span key={i} style={{ color: 'var(--droid-text-muted)' }}>
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
// Code follows the reader's code font size setting; a spec reads one step up.
const SPEC_CODE_SIZE_CLASS = 'text-[length:calc(var(--code-font-size)+1px)]';

function LineGutter({ count, sizeClass }: { count: number; sizeClass: string }) {
  return (
    <div
      aria-hidden
      className={`mr-4 shrink-0 select-none text-right font-mono leading-[1.65] text-droid-text-muted/55 ${sizeClass}`}
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
        <button onClick={onToggleCollapse} className={CARD_CONTROL_CLASS}>
          {collapsed ? 'Show all' : 'Collapse'}
        </button>
      )}
      <button
        onClick={onToggleWrap}
        className={`${CARD_CONTROL_CLASS} ${wrapped ? 'bg-droid-active text-droid-text' : ''}`}
        title={wrapped ? 'Disable soft wrap' : 'Soft wrap long lines'}
        aria-pressed={wrapped}
      >
        <WrapText className="h-3 w-3" />
      </button>
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
  const sizeClass = specMode ? SPEC_CODE_SIZE_CLASS : '';
  // The added 0.25rem is the <pre>'s top padding (pt-1).
  const collapsedMaxHeight = `calc((var(--code-font-size) + ${specMode ? '1px' : '0px'}) * 1.65 * ${String(COLLAPSED_LINES)} + 0.25rem)`;

  return (
    <div
      className={`overflow-hidden rounded-xl bg-droid-elevated/50 ${specMode ? 'my-4' : 'my-2.5'}`}
    >
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
            {showGutter && <LineGutter count={lines.length} sizeClass={sizeClass} />}
            <code
              className={`font-mono leading-[1.65] text-droid-text/90 ${wrapped ? 'whitespace-pre-wrap break-words' : 'whitespace-pre'} ${sizeClass}`}
            >
              {highlighted ?? code}
            </code>
          </pre>
        </div>
        {collapsed && (
          <div className="absolute inset-x-0 bottom-2.5 flex justify-center">
            <button
              onClick={() => {
                setCollapsed(false);
              }}
              className="flex h-7 items-center gap-1 rounded-full bg-droid-raised px-3 text-[11.5px] font-medium text-droid-text-secondary shadow-droid-sm transition-colors duration-150 hover:text-droid-text focus-visible:text-droid-text focus-visible:outline-none"
            >
              <ChevronDown className="h-3 w-3" />
              Show all {String(lines.length)} lines
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
