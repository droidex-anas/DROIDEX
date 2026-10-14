import { useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Markdown } from './Markdown';
import { fitSvgMarkup, svgImageAlternative } from '../lib/svgMarkup';
import { LayoutTemplate } from '@droidex/icons';

type Segment =
  | { type: 'text'; content: string }
  | { type: 'svg'; content: string; source: 'code' | 'inline' };

// Arrival motion (docs/design-system/feel.md): 200ms smooth-out, staggered
// 30ms per card, rising 8px.
const EASE = [0.22, 1, 0.36, 1] as const;

function parseSpecSegments(markdown: string): Segment[] {
  const segments: Segment[] = [];
  const matches: {
    start: number;
    end: number;
    content: string;
    kind: 'svg' | 'mermaid' | 'inline';
  }[] = [];

  // Pattern 1: fenced code blocks ```svg or ```mermaid
  const codeRegex = /```(?:svg|mermaid)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = codeRegex.exec(markdown)) !== null) {
    const isMermaid = markdown.slice(m.index, m.index + 12).includes('mermaid');
    matches.push({
      start: m.index,
      end: m.index + m[0].length,
      content: m[1].trim(),
      kind: isMermaid ? 'mermaid' : 'svg',
    });
  }

  // Pattern 2: inline <svg>...</svg> (skip overlaps with code blocks)
  const inlineRegex = /(<svg\b[\s\S]*?<\/svg>)/g;
  while ((m = inlineRegex.exec(markdown)) !== null) {
    const overlaps = matches.some((cb) => m!.index < cb.end && m!.index + m![0].length > cb.start);
    if (!overlaps) {
      matches.push({
        start: m.index,
        end: m.index + m[0].length,
        content: m[0],
        kind: 'inline',
      });
    }
  }

  matches.sort((a, b) => a.start - b.start);

  let last = 0;
  for (const match of matches) {
    if (match.start > last) {
      segments.push({ type: 'text', content: markdown.slice(last, match.start) });
    }
    if (match.kind === 'mermaid') {
      // Render mermaid as a styled code block until mermaid.js is added
      segments.push({ type: 'text', content: '```mermaid\n' + match.content + '\n```' });
    } else {
      segments.push({
        type: 'svg',
        content: match.content,
        source: match.kind === 'inline' ? 'inline' : 'code',
      });
    }
    last = match.end;
  }
  if (last < markdown.length) {
    segments.push({ type: 'text', content: markdown.slice(last) });
  }
  if (segments.length === 0) {
    segments.push({ type: 'text', content: markdown });
  }
  return segments;
}

function SvgVisualCard({ svgContent, index }: { svgContent: string; index: number }) {
  const reduceMotion = useReducedMotion();
  const image = useMemo(
    () => ({
      src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(fitSvgMarkup(svgContent))}`,
      alt: svgImageAlternative(svgContent),
    }),
    [svgContent],
  );

  return (
    <motion.div
      initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: EASE, delay: Math.min(index * 0.03, 0.3) }}
      className="rounded-xl bg-elevated p-4"
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-label text-muted">
          <LayoutTemplate aria-hidden="true" className="size-icon-sm" />
          Diagram
        </span>
        <span className="text-caption text-muted">SVG</span>
      </div>
      <div className="flex min-h-24 items-center justify-center pt-3">
        <img className="block w-full h-auto" src={image.src} alt={image.alt} />
      </div>
    </motion.div>
  );
}

export function SpecRenderer({ content }: { content: string }) {
  const segments = useMemo(() => parseSpecSegments(content), [content]);

  return (
    <div className="space-y-5">
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <div key={i} className="spec-text">
            <Markdown specMode>{seg.content}</Markdown>
          </div>
        ) : (
          <SvgVisualCard key={i} svgContent={seg.content} index={i} />
        ),
      )}
    </div>
  );
}
