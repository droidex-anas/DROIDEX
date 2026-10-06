import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react';
import { Maximize2 } from 'lucide-react';
import type { Mermaid } from 'mermaid';

import { useVisibleOnce } from '../hooks/useVisibleOnce';
import { fitSvgMarkup, svgImageAlternative } from '../lib/svgMarkup';
import { appColorScheme } from './appBlockRuntime';
import { CARD_CONTROL_CLASS, CardHeader, CodeCard, CodeCopyButton } from './MarkdownCode';
import { ImageLightbox } from './media/ImageLightbox';

/* Renderers for the fenced languages that draw a diagram instead of code. */

type ColorScheme = 'light' | 'dark';

let mermaidPromise: Promise<Mermaid> | null = null;
let mermaidScheme: ColorScheme | null = null;

// Mermaid's configuration is global, so the theme is set before each render
// from the app's current canvas; its dark theme draws light ink that vanishes
// on a light canvas.
async function loadMermaid(scheme: ColorScheme): Promise<Mermaid> {
  mermaidPromise ??= import('mermaid').then(({ default: mermaid }) => mermaid);
  const mermaid = await mermaidPromise;
  if (mermaidScheme !== scheme) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: scheme === 'dark' ? 'dark' : 'neutral',
      themeVariables: {
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        fontSize: '13px',
      },
    });
    mermaidScheme = scheme;
  }
  return mermaid;
}

function currentColorScheme(): ColorScheme {
  const canvas = getComputedStyle(document.documentElement).getPropertyValue('--droid-bg');
  return appColorScheme(canvas.trim());
}

// applyTheme writes the palette onto the root element's style, so a change
// there is the moment a drawn diagram may need the other scheme.
function subscribeToThemeChanges(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style', 'class'],
  });
  return () => {
    observer.disconnect();
  };
}

let mermaidSeq = 0;

// Models frequently emit flowchart syntax mermaid rejects (unquoted special
// characters in subgraph titles, and `[/text]` which mermaid reads as a
// parallelogram shape). Quote these so common flowcharts render instead of
// falling back to a raw code block.
function sanitizeMermaid(src: string): string {
  return src
    .split('\n')
    .map((line) => {
      const sg = /^(\s*subgraph\s+)(.+?)\s*$/i.exec(line);
      if (sg) {
        const title = sg[2].trim();
        const alreadySafe = title.startsWith('"') || /^[\w-]+(\[.*\]|\(.*\))?$/.test(title);
        if (!alreadySafe && /[/()\-:&.,]/.test(title)) {
          return `${sg[1]}"${title.replace(/"/g, '')}"`;
        }
        return line;
      }
      // [/register] -> ["/register"] (but keep real parallelograms [/text/]).
      return line.replace(/\[\/([^/\]\n]+)\]/g, '["/$1"]');
    })
    .join('\n');
}

function svgDataUrl(markup: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

// Mermaid serializes its SVG as HTML (a bare `<br>` inside labels), which is
// not valid XML, so an image of it would fail to load; parse it inertly and
// re-serialize as XML. Its root also caps its own width, which would keep it
// small in the full view.
function mermaidImageSrc(svg: string): string | null {
  const root = new DOMParser().parseFromString(svg, 'text/html').querySelector('svg');
  if (!root) return null;
  root.style.removeProperty('max-width');
  return svgDataUrl(new XMLSerializer().serializeToString(root));
}

function DiagramCard({
  kind,
  source,
  viewLabel,
  imageSrc,
  hostRef,
  children,
}: {
  kind: string;
  source: string;
  viewLabel: string;
  // Built on demand: only an expanded diagram pays for its full-view image.
  imageSrc: (() => string | null) | null;
  hostRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  const [expandedSrc, setExpandedSrc] = useState<string | null>(null);
  return (
    <div ref={hostRef} className="my-3 overflow-hidden rounded-xl bg-droid-elevated/50">
      <CardHeader label={kind}>
        <button
          onClick={() => {
            setExpandedSrc(imageSrc?.() ?? null);
          }}
          disabled={!imageSrc}
          className={CARD_CONTROL_CLASS}
          title="Expand diagram"
          aria-label={`Expand ${viewLabel}`}
        >
          <Maximize2 className="h-3 w-3" />
          Expand
        </button>
        <CodeCopyButton text={source} />
      </CardHeader>
      <div className="flex min-h-[96px] items-center justify-center px-5 pb-5 pt-1">{children}</div>
      {expandedSrc && (
        <ImageLightbox
          src={expandedSrc}
          label={viewLabel}
          vector
          onClose={() => {
            setExpandedSrc(null);
          }}
        />
      )}
    </div>
  );
}

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const idRef = useRef(`mmd-${String(++mermaidSeq)}`);
  const hostRef = useRef<HTMLDivElement>(null);
  const visible = useVisibleOnce(hostRef);
  const scheme = useSyncExternalStore<ColorScheme>(
    subscribeToThemeChanges,
    currentColorScheme,
    // A static render draws no diagram, so its scheme is never used.
    () => 'dark',
  );

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const raw = code.trim();
    loadMermaid(scheme)
      .then(async (mermaid) => {
        try {
          return await mermaid.render(idRef.current, raw);
        } catch {
          // Retry once with a sanitized version of common bad flowchart syntax.
          return mermaid.render(`${idRef.current}-s`, sanitizeMermaid(raw));
        }
      })
      .then(({ svg }) => {
        if (!cancelled) {
          setSvg(svg);
          setError('');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [code, scheme, visible]);

  if (error) return <CodeCard code={code} className="language-mermaid" />;

  return (
    <DiagramCard
      kind="Mermaid"
      source={code}
      viewLabel="Mermaid diagram"
      imageSrc={svg ? () => mermaidImageSrc(svg) : null}
      hostRef={hostRef}
    >
      {svg ? (
        <div
          className="flex w-full animate-fade-in justify-center [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <span className="text-[12px] text-droid-text-muted/70">Rendering diagram…</span>
      )}
    </DiagramCard>
  );
});

export function SvgCodeBlock({ content }: { content: string }) {
  const image = useMemo(
    () => ({ src: svgDataUrl(fitSvgMarkup(content)), alt: svgImageAlternative(content) }),
    [content],
  );

  return (
    <DiagramCard kind="SVG" source={content} viewLabel={image.alt} imageSrc={() => image.src}>
      {/* Capped so a tall drawing stays a preview; Expand shows it whole. */}
      <img className="block max-h-[420px] w-full object-contain" src={image.src} alt={image.alt} />
    </DiagramCard>
  );
}
