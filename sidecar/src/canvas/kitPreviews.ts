// A kit's previews (design system documents spec §7): one example of one kit
// version, compiled in one mode through the same compiler as frames, with no
// revision to select in and no adherence. Versions are immutable, so an answer
// about the source is kept in memory and compiled once while it is kept. An
// agent's unsaved kit is checked through the same compiler and never kept.

import { realDeadline, type BuildDeadline } from './CanvasBuilds.js';
import { buildFailure } from './canvasBuildFailures.js';
import { boundDiagnostics } from './canvasDiagnostics.js';
import { canvasError } from './canvasError.js';
import { CompilerWorker, type KitPreviewCompileInput } from './compiler.js';
import { DESIGN_ENTRY } from './designEntry.js';
import type { DocumentSection } from './designSystemDocument.js';
import { KIT_ENTRY, readDesignSystem, type DesignSystem } from './designSystems.js';
import type { CanvasDiagnostic, DesignSystemRef, PreviewArtifact } from './protocol.js';

/** What a preview tile loads, or the diagnostics it shows instead. */
export type KitPreview =
  | { status: 'ready'; artifact: PreviewArtifact }
  | { status: 'failed'; diagnostics: CanvasDiagnostic[] };

type KitCompiler = Pick<CompilerWorker, 'compile' | 'terminate'>;

export interface KitPreviewsDeps {
  compiler?: () => KitCompiler;
  deadline?: BuildDeadline;
}

/** `kept` is false for a failure of the attempt rather than of the source. */
interface Answer {
  preview: KitPreview;
  kept: boolean;
}

const MAX_KEPT_PREVIEWS = 32;
const SHUTTING_DOWN = 'DROIDEX is shutting down.';
// A side-effect import, which the TypeScript loader keeps, so the kit's entry is bundled.
const KIT_ENTRY_CHECK = `import '@droidex/design-system';

export default function KitEntry() {
  return null;
}
`;

export class KitPreviews {
  private compiler: KitCompiler | null = null;
  /** Answers about the source, most recently read last. */
  private readonly kept = new Map<string, KitPreview>();
  /** Compiles still running, so a second read joins one rather than starting another. */
  private readonly pending = new Map<string, Promise<Answer>>();
  private readonly running = new Set<AbortController>();
  private readonly ending = new Set<Promise<void>>();
  private readonly fork: () => KitCompiler;
  private readonly deadline: BuildDeadline;
  private closed = false;

  constructor(deps: KitPreviewsDeps = {}) {
    this.fork = deps.compiler ?? (() => new CompilerWorker());
    this.deadline = deps.deadline ?? realDeadline;
  }

  /** The preview `item` names in that kit version and mode. */
  async read(ref: DesignSystemRef, item: string): Promise<KitPreview> {
    this.refuseClosed();
    const key = JSON.stringify([ref.id, ref.version, ref.mode, item]);
    const kept = this.kept.get(key);
    if (kept) {
      this.keep(key, kept);
      return kept;
    }
    const { preview } = await (this.pending.get(key) ?? this.start(key, ref, item));
    this.refuseClosed();
    return preview;
  }

  /**
   * Compiles a kit that may not be saved yet: its entry, then each example its
   * cover and previews show, once each. Returns the failures' diagnostics, none
   * when everything builds. One stylesheet carries both modes and the mode is
   * only the document's `data-mode`, so one compile answers for both.
   */
  async check(
    kit: Pick<DesignSystem, 'files' | 'sections' | 'cover' | 'examples'>,
  ): Promise<CanvasDiagnostic[]> {
    const source = { files: kit.files, sections: kit.sections };
    const entries: [string, string][] = [[KIT_ENTRY, KIT_ENTRY_CHECK]];
    for (const name of shownExamples(kit)) entries.push([`examples/${name}`, kit.examples[name]]);
    const diagnostics: CanvasDiagnostic[] = [];
    for (const [file, example] of entries) {
      this.refuseClosed();
      const { preview } = await this.compile({
        kind: 'kitPreview',
        kit: source,
        mode: 'light',
        example,
      });
      if (preview.status === 'ready') continue;
      // The entry stands in for the example it compiled; the kit's own files keep their paths.
      for (const diagnostic of preview.diagnostics)
        diagnostics.push(diagnostic.file === DESIGN_ENTRY ? { ...diagnostic, file } : diagnostic);
    }
    this.refuseClosed();
    return boundDiagnostics(diagnostics);
  }

  /** Refuses every read and cancels every compile; nothing compiles after this. */
  async close(): Promise<void> {
    this.closed = true;
    this.kept.clear();
    for (const abort of this.running) abort.abort();
    if (this.compiler) this.end(this.compiler);
    while (this.ending.size > 0) await Promise.all([...this.ending]);
  }

  private start(key: string, ref: DesignSystemRef, item: string): Promise<Answer> {
    const answer = this.compileItem(ref, item);
    this.pending.set(key, answer);
    void answer.then(
      ({ preview, kept }) => {
        this.pending.delete(key);
        if (kept && !this.closed) this.keep(key, preview);
      },
      () => this.pending.delete(key),
    );
    return answer;
  }

  /** Map order is recency: a kept key moves to the end, and the front is evicted. */
  private keep(key: string, preview: KitPreview): void {
    this.kept.delete(key);
    this.kept.set(key, preview);
    if (this.kept.size <= MAX_KEPT_PREVIEWS) return;
    const oldest = this.kept.keys().next().value;
    if (oldest !== undefined) this.kept.delete(oldest);
  }

  private refuseClosed(): void {
    if (this.closed) throw canvasError('scope_expired', SHUTTING_DOWN);
  }

  private async compileItem(ref: DesignSystemRef, item: string): Promise<Answer> {
    const system = await readDesignSystem(ref);
    const example = kitExample(system, item);
    this.refuseClosed();
    const kit = { files: system.files, sections: system.sections };
    return this.compile({ kind: 'kitPreview', kit, mode: ref.mode, example });
  }

  private async compile(input: KitPreviewCompileInput): Promise<Answer> {
    const compiler = (this.compiler ??= this.fork());
    const abort = new AbortController();
    let overdue = false;
    // A compiler wedged inside the bundler reads no signal, so it is ended.
    const cancelDeadline = this.deadline(() => {
      overdue = true;
      abort.abort();
      this.end(compiler);
    });
    this.running.add(abort);
    try {
      const { artifactId, html } = await compiler.compile(input, abort.signal);
      return { preview: { status: 'ready', artifact: { artifactId, html } }, kept: true };
    } catch (error) {
      const failure = buildFailure(error, overdue);
      if (failure?.result.status !== 'failed') throw error;
      const { diagnostics } = failure.result;
      return { preview: { status: 'failed', diagnostics }, kept: failure.persists };
    } finally {
      cancelDeadline();
      this.running.delete(abort);
    }
  }

  /** The next compile forks a fresh process; this one is ended once. */
  private end(compiler: KitCompiler): void {
    if (this.compiler === compiler) this.compiler = null;
    const ended = compiler.terminate().catch((error: unknown) => {
      console.error('A kit preview compiler was not stopped cleanly:', error);
    });
    this.ending.add(ended);
    void ended.then(() => this.ending.delete(ended));
  }
}

/**
 * The source `item` names in this version: `cover`, the `typography` specimen,
 * or the id of one of its previews.
 */
export function kitExample(system: DesignSystem, item: string): string {
  if (item === 'typography') return typographySpecimen(system.sections);
  const name = exampleName(system, item);
  const source = name === undefined ? undefined : system.examples[name];
  if (source === undefined)
    throw canvasError('invalid_input', 'That preview is not in this design system version.');
  return source;
}

/** The examples a kit's cover and previews show, each once. */
function shownExamples(kit: Pick<DesignSystem, 'sections' | 'cover'>): string[] {
  const names = kit.sections.flatMap((section) =>
    section.items.flatMap((item) => (item.kind === 'preview' ? [item.example] : [])),
  );
  if (kit.cover?.kind === 'preview') names.push(kit.cover.example);
  return [...new Set(names)];
}

function exampleName(system: DesignSystem, item: string): string | undefined {
  if (item === 'cover') return system.cover?.kind === 'preview' ? system.cover.example : undefined;
  for (const section of system.sections)
    for (const entry of section.items)
      if (entry.kind === 'preview' && entry.id === item) return entry.example;
  return undefined;
}

/**
 * Every typography token set on one line of sample text, which runs off the
 * edge rather than wrap so the document can size the tile from the tokens.
 * Kit fonts load only inside a preview guest, so the document shows them
 * through this example.
 */
function typographySpecimen(sections: DocumentSection[]): string {
  const groups: { id: string; title: string; tokens: { name: string; property: string }[] }[] = [];
  for (const section of sections) {
    if (section.kind !== 'typography') continue;
    for (const item of section.items) {
      if (item.kind !== 'group') continue;
      const tokens = item.tokens.map(({ name }) => ({ name, property: typeProperty(name) }));
      groups.push({ id: item.id, title: item.title, tokens });
    }
  }
  if (groups.length === 0)
    throw canvasError('invalid_input', 'This design system has no typography tokens.');
  return `const GROUPS = ${JSON.stringify(groups)};

export default function Typography() {
  return (
    <main style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: 32, minHeight: '100vh', boxSizing: 'border-box', overflow: 'hidden', background: 'var(--ds-canvas)', color: 'var(--ds-fg)' }}>
      {GROUPS.map((group) => (
        <section key={group.id} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: 'var(--ds-fg-muted)' }}>{group.title}</h2>
          {group.tokens.map((token) => (
            <div key={token.name} style={{ display: 'flex', alignItems: 'baseline', gap: 24 }}>
              <code style={{ flex: '0 0 200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--ds-fg-muted)' }}>{token.name}</code>
              <span style={{ whiteSpace: 'nowrap', [token.property]: \`var(\${token.name})\` }}>The quick brown fox jumps over the lazy dog</span>
            </div>
          ))}
        </section>
      ))}
    </main>
  );
}
`;
}

// Kits name their type tokens by what they set (--ds-font-sans, --ds-text-lg,
// --ds-weight-bold); a name that says nothing else is a size.
function typeProperty(name: string): string {
  if (name.includes('weight')) return 'fontWeight';
  if (name.includes('leading') || name.includes('line-height')) return 'lineHeight';
  if (name.includes('tracking') || name.includes('letter-spacing')) return 'letterSpacing';
  if ((name.includes('font') || name.includes('family')) && !name.includes('size'))
    return 'fontFamily';
  return 'fontSize';
}
