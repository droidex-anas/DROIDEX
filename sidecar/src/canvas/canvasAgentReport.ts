// What the agent is told about a frame: its identity and place, and a compact
// account of its build with each diagnostic's file and line and the step that
// follows. Element maps and manifest versions stay out, because they cost the
// model thousands of tokens and answer nothing it can act on.
//
// canvas_write waits a bounded time for the build it started and then for an
// open preview to say whether it rendered, so an agent that broke its design
// hears why inside the same call and fixes it in the same turn. The call always
// ends: a slow build is reported as still building, an unconfirmed render as
// built.

import type { CanvasChangeFeed } from './canvasChangeFeed.js';
import type { CanvasPreviewReports } from './canvasPreviewReports.js';
import type { CanvasDiagnostic, CanvasFrame, PreviewReport } from './protocol.js';
import { CANVAS_LIMITS } from './schema.js';

/** The build deadline plus room for a build queued behind the other slots. */
const BUILD_WAIT_MS = CANVAS_LIMITS.buildDeadlineMs + 5_000;

/** How soon an open pane starts the preview of a build it was just sent. */
const PREVIEW_START_MS = 1_500;
/**
 * From the pane's first `loading`: the guest's own ten-second ready deadline,
 * which starts only once the guest is bound, and a moment for its report.
 */
const PREVIEW_RENDER_MS = 13_000;

/** The first few diagnostics are the ones worth fixing; the rest repeat them. */
const REPORTED_DIAGNOSTICS = 8;

export type BuildReport =
  | { status: 'empty'; next: string }
  | { status: 'queued' | 'building'; revisionId: string; next: string }
  | {
      status: 'ready';
      revisionId: string;
      /** True once an open preview painted it; absent when no pane confirmed it. */
      rendered?: true;
      /** What the rendered design has thrown since it painted. */
      errors?: string[];
      warnings?: AgentDiagnostic[];
      next: string;
    }
  | { status: 'render_failed'; revisionId: string; errors: string[]; next: string }
  | {
      status: 'failed';
      revisionId: string;
      diagnostics: AgentDiagnostic[];
      lastWorkingRevisionId: string | null;
      next: string;
    }
  | { status: 'cancelled'; revisionId: string; next: string };

/** A diagnostic without esbuild's byte column, which no editor position matches. */
type AgentDiagnostic = Pick<CanvasDiagnostic, 'code' | 'message' | 'file' | 'line'>;

export interface AgentFrame {
  designId: string;
  name: string;
  rect: CanvasFrame['rect'];
  layoutVersion: number;
  revisionId: string | null;
  build: BuildReport;
}

export function agentFrame(frame: CanvasFrame, preview: PreviewReport | null): AgentFrame {
  return {
    designId: frame.designId,
    name: frame.name,
    rect: frame.rect,
    layoutVersion: frame.layoutVersion,
    revisionId: frame.revisionId,
    build: buildReport(frame, preview),
  };
}

/** `preview` is the pane's latest report on the frame's current revision. */
export function buildReport(frame: CanvasFrame, preview: PreviewReport | null): BuildReport {
  const { build, revisionId } = frame;
  if (revisionId === null)
    return {
      status: 'empty',
      next: 'No source yet. Write main.tsx with canvas_write, expectedRevisionId null.',
    };
  if (build.status === 'ready') return readyReport(revisionId, build.diagnostics, preview);
  if (build.status === 'failed') {
    const diagnostics = build.diagnostics.slice(0, REPORTED_DIAGNOSTICS).map(agentDiagnostic);
    return {
      status: 'failed',
      revisionId,
      diagnostics,
      lastWorkingRevisionId: build.lastWorkingRevisionId,
      next: `Fix ${place(diagnostics[0])} and write again with expectedRevisionId "${revisionId}".`,
    };
  }
  if (build.status === 'cancelled')
    return {
      status: 'cancelled',
      revisionId,
      next: 'The build was cancelled, so nothing new rendered. Write the frame again to rebuild it.',
    };
  // A restored frame whose artifact is gone waits here until a pane opens it.
  if (build.status === 'pending')
    return {
      status: 'queued',
      revisionId,
      next: 'Not built yet. It builds when a canvas pane shows it; writing it again rebuilds it now.',
    };
  return {
    status: 'building',
    revisionId,
    next: 'Still building. Call canvas_inspect for the outcome before revising it.',
  };
}

function readyReport(
  revisionId: string,
  diagnostics: CanvasDiagnostic[],
  preview: PreviewReport | null,
): BuildReport {
  const again = `write again with expectedRevisionId "${revisionId}"`;
  if (preview?.outcome === 'failed')
    return {
      status: 'render_failed',
      revisionId,
      errors: preview.errors,
      next: `It built, but the preview stopped before it rendered. Fix the error and ${again}.`,
    };
  const warnings = diagnostics.slice(0, REPORTED_DIAGNOSTICS).map(agentDiagnostic);
  const rendered = preview?.outcome === 'rendered';
  const errors = rendered ? preview.errors : [];
  let next = `Built; no open preview has confirmed it renders. To change it, ${again}.`;
  if (preview?.outcome === 'loading')
    next = `Built; its preview is still loading. Call canvas_inspect in a moment to read whether it rendered.`;
  if (rendered) next = `Built and rendered. To change it, ${again}.`;
  if (errors.length > 0) next = `It rendered, then threw. Fix the error and ${again}.`;
  return {
    status: 'ready',
    revisionId,
    ...(rendered ? { rendered: true as const } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    next,
  };
}

/**
 * The open pane's latest word on a frame that just built, once its preview
 * rendered or failed or the wait ran out: null when no pane started a preview
 * soon, `loading` when one never settled. The first `loading` fixes the one
 * deadline, so remounts cannot stretch the call.
 */
export function renderedPreview(
  previews: CanvasPreviewReports,
  canvasId: string,
  frame: CanvasFrame,
): Promise<PreviewReport | null> {
  return new Promise((resolve) => {
    const current = previews.reportFor(canvasId, frame);
    if (current && current.outcome !== 'loading') {
      resolve(current);
      return;
    }
    let unsubscribe = (): void => undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = current !== null;
    const finish = (report: PreviewReport | null) => {
      unsubscribe();
      clearTimeout(timer);
      resolve(report);
    };
    // Unref'd like the build wait: a pending report is never why the sidecar stays up.
    const waitFor = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        finish(previews.reportFor(canvasId, frame));
      }, ms).unref();
    };
    waitFor(loading ? PREVIEW_RENDER_MS : PREVIEW_START_MS);
    unsubscribe = previews.subscribe((reported, report) => {
      if (reported !== canvasId || report.designId !== frame.designId) return;
      if (report.revisionId !== frame.revisionId) return;
      if (report.outcome !== 'loading') finish(report);
      else if (!loading) {
        loading = true;
        waitFor(PREVIEW_RENDER_MS);
      }
    });
  });
}

/**
 * The frame once the build of `revisionId` settles, it is superseded or removed,
 * or the wait runs out; nothing once the workspace closes. Read and subscribed
 * in one tick, so an outcome that landed before the call is read and one that
 * lands after it is heard.
 */
export function settledFrame(
  changes: CanvasChangeFeed,
  readFrame: () => CanvasFrame | undefined,
  revisionId: string,
): Promise<CanvasFrame | undefined> {
  return new Promise((resolve) => {
    const current = safely(readFrame);
    if (!current || isSettled(current, revisionId)) {
      resolve(current);
      return;
    }
    const { designId } = current;
    let unsubscribe = (): void => undefined;
    const finish = (frame: CanvasFrame | undefined) => {
      unsubscribe();
      clearTimeout(timer);
      resolve(frame);
    };
    // Unref'd so a write waiting on its build is never why the sidecar stays up.
    const timer = setTimeout(() => {
      finish(safely(readFrame));
    }, BUILD_WAIT_MS).unref();
    unsubscribe = changes.subscribe(
      (change) => {
        const frame = change.frames.find((entry) => entry.designId === designId);
        if (frame && isSettled(frame, revisionId)) finish(frame);
        else if (change.removedDesignIds.includes(designId)) finish(undefined);
      },
      // A closed workspace publishes nothing more, so its last word is the receipt.
      () => {
        finish(undefined);
      },
    );
  });
}

/** Built, failed or cancelled at this revision, or moved past it by a newer write. */
function isSettled(frame: CanvasFrame, revisionId: string): boolean {
  if (frame.revisionId !== revisionId) return true;
  const { build } = frame;
  return (
    (build.status === 'ready' || build.status === 'failed' || build.status === 'cancelled') &&
    build.revisionId === revisionId
  );
}

/** A canvas that closed under the wait has nothing left to report. */
function safely(readFrame: () => CanvasFrame | undefined): CanvasFrame | undefined {
  try {
    return readFrame();
  } catch {
    return undefined;
  }
}

function agentDiagnostic({ code, message, file, line }: CanvasDiagnostic): AgentDiagnostic {
  return { code, message, ...(file ? { file } : {}), ...(line ? { line } : {}) };
}

function place(diagnostic: AgentDiagnostic | undefined): string {
  if (!diagnostic?.file) return 'the source';
  return diagnostic.line ? `${diagnostic.file} line ${String(diagnostic.line)}` : diagnostic.file;
}
