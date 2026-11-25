import type { DesignSystemRef, PropPick } from './design-systems.js';
import type { Annotation, AnnotationChange } from './annotations.js';

/** How a canvas holds its designs to their pinned kit; `guide` is the default. */
export type DesignSystemAdherence = 'off' | 'guide' | 'strict';

export interface CreateCanvasResult {
  /** The canvas this mutation originally created, unchanged by a replay. */
  canvasId: string;
  /** The chat's attachment when this request settled; only this updates its cache. */
  attachedCanvasId: string | null;
}

/** A canvas an earlier DROIDEX saved in an older format; it is not opened. */
export interface OutdatedCanvas {
  canvasId: string;
  name: string;
}

/** The canvas a chat works on, or null while it is unattached (spec §6). */
export interface CanvasAttachment {
  canvasId: string | null;
  /** A canvas an earlier DROIDEX made for this chat, which cannot be opened. */
  outdated?: OutdatedCanvas;
}

export interface DesignRef {
  designId: string;
  revisionId: string | null;
}

export interface RevisionRef {
  designId: string;
  revisionId: string;
}

export type CanvasSeed =
  | { kind: 'revision'; canvasId: string; revision: RevisionRef }
  | { kind: 'library'; itemId: string }
  | { kind: 'svg'; assetId: string }
  /** The frame's kit catalog entry alone on its page, with the picked props written on it. */
  | { kind: 'component'; entry: string; props: PropPick[] };

// A selected element inside one rendered revision. `instancePath` distinguishes
// repeated DOM nodes; it is a selection hint, not a second source model.
export interface ElementRef {
  designId: string;
  revisionId: string;
  elementId: string;
  instancePath: string;
}

// The references a request pins when it is composed. They travel with the
// prompt through queue, steer and send-now, so a later selection change cannot
// retarget an earlier request.
export interface CanvasTurnContext {
  designs: DesignRef[];
  elements: ElementRef[];
  designSystem: DesignSystemRef;
  /** Owned images attached as references; absent when there are none. */
  images?: { assetId: string }[];
}

/**
 * One built revision's preview document and the ID of that document. A preview
 * loads this in its guest; nothing else reads it.
 */
export interface PreviewArtifact {
  artifactId: string;
  html: string;
}

/** What a kit preview tile loads, or the diagnostics it shows instead. */
export type KitPreview =
  | { status: 'ready'; artifact: PreviewArtifact }
  | { status: 'failed'; diagnostics: CanvasDiagnostic[] };

/** One `@font-face` a kit declares, its descriptors as written and its WOFF2 file as base64. */
export interface KitFontFace {
  family: string;
  style: string;
  weight: string;
  unicodeRange: string;
  woff2: string;
}

/**
 * What one mounted preview of a revision did, as the pane running it saw it:
 * `loading` while its guest starts, `failed` when the design stopped before it
 * rendered, `rendered` once it painted, with any errors it has thrown since.
 * The compiler cannot see a design that throws while rendering; this can.
 */
export interface PreviewReport {
  designId: string;
  revisionId: string;
  outcome: 'loading' | 'rendered' | 'failed';
  errors: string[];
}

export interface OwnedAsset {
  assetId: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  byteLength: number;
  width: number;
  height: number;
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SourceFiles = Record<string, string>;

export interface CanvasDiagnostic {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface SourceElement {
  elementId: string;
  file: string;
  start: number;
  end: number;
  /** The 1-based line `start` is on, for display; the offsets are what locate the element. */
  line: number;
  tagName: string;
  /** The capitalised function it is written in, as React names a component; null outside one. */
  component: string | null;
  editability: 'literal' | 'computed' | 'shared';
}

/** One row of a design's source outline: something written in its source, nested as written. */
export interface OutlineNode {
  /** Unique within its outline: an element opened through two instances is two rows. */
  nodeId: string;
  /** Null for a row the root component renders directly. */
  parentId: string | null;
  kind: 'element' | 'instance' | 'repeat' | 'condition';
  /** The tag, the component's name, 'Repeat' or 'Condition'. */
  name: string;
  /** An element's own literal text, on one line, 64 code points at most. */
  text: string | null;
  /** The element's marker; null for the other kinds. */
  elementId: string | null;
  /** Why it cannot be edited directly: in a repeat, rendered several times, worked out in code, or the kit's. */
  lock: 'repeated' | 'shared' | 'computed' | 'kit' | null;
  /** A direct JSX child, so it can be moved, removed or copied as a whole. */
  free: boolean;
  /** An element whose props set or may set its content, so it takes no written children. */
  contentFromProps: boolean;
  /**
   * An element is 'shown' unless Tailwind's `hidden` class hides it ('hidden'),
   * or the layers panel can't tell or change whether it shows: its classes or
   * props come from code ('computed'), a class or style decides its display
   * ('display'), or a `hidden` attribute does ('attribute'). Other kinds are 'shown'.
   */
  visibility: 'shown' | 'hidden' | 'computed' | 'display' | 'attribute';
}

/** What a design's root renders, in reading order, and whether it stopped at a cap. */
export interface SourceOutline {
  nodes: OutlineNode[];
  truncated: boolean;
}

/** What one design's build is doing, on its own. */
export type CanvasBuildOutcome =
  | { status: 'pending' }
  | { status: 'building'; revisionId: string }
  | {
      status: 'ready';
      revisionId: string;
      artifactId: string;
      elements: SourceElement[];
      outline: SourceOutline;
      diagnostics: CanvasDiagnostic[];
    }
  | {
      status: 'failed';
      revisionId: string;
      diagnostics: CanvasDiagnostic[];
      lastWorkingRevisionId: string | null;
    }
  | { status: 'cancelled'; revisionId: string | null };

/**
 * One design's build state and the attempt it belongs to. `generation` counts
 * the design's build attempts and only goes up: the sidecar publishes a result
 * only while its attempt is the latest, and the renderer takes a new generation
 * as a new build even when identical source rebuilt to the same artifact.
 */
export type CanvasBuildState = CanvasBuildOutcome & { generation: number };

export interface CanvasFrame {
  designId: string;
  name: string;
  rect: FrameRect;
  layoutVersion: number;
  manifestVersion: number;
  // null while the frame is reserved and has no source yet.
  revisionId: string | null;
  designSystem: DesignSystemRef;
  /** The frame this one is a variant of; its set is every frame naming the same one. */
  variantOf: string | null;
  /** The copy its seed made; while `revisionId` is this one, nobody has changed it. */
  seededRevisionId: string | null;
  /** The user hid it from the board; an agent still reads and writes it. */
  hidden: boolean;
  build: CanvasBuildState;
}

// `sequence` orders renderer projections; it is not the source CAS token.
export interface CanvasSnapshot {
  canvasId: string;
  sequence: number;
  frames: CanvasFrame[];
  /** The CAS token `canvas.annotate` expects, separate from frame layout. */
  annotationsVersion: number;
  annotations: Annotation[];
}

/** A frame as a change reports it: its build travels apart, and only when it changed. */
export type ChangedFrame = Omit<CanvasFrame, 'build'>;

export interface FrameBuild {
  designId: string;
  build: CanvasBuildState;
}

export interface CanvasChange {
  canvasId: string;
  sequence: number;
  frames: ChangedFrame[];
  /** The builds this change moved; a frame new to the canvas always has its build here. */
  builds: FrameBuild[];
  removedDesignIds: string[];
  /** Present only on a change that touched the annotation layer. */
  annotations?: AnnotationChange;
  /** Present only on a reorder: every frame's designId, back to front. */
  order?: string[];
}

export interface CanvasSummary {
  canvasId: string;
  name: string;
  updatedAt: number;
  designCount: number;
  /** The chats working on this canvas, used by Design cards and the chat menu. */
  attachedAppSessionIds: string[];
  designSystemAdherence: DesignSystemAdherence;
}

// `create` answers with the canvas as well as the frames because an unattached
// chat's first create mints the canvas it is now attached to (spec §6).
export interface CreateFramesResult {
  canvasId: string;
  frames: CanvasFrame[];
  svgAsImage?: { designId: string; reason: 'too_large' | 'stylesheet' }[];
}

export interface WriteReceipt {
  designId: string;
  revisionId: string;
  sequence: number;
}

/** Why a frame seeded from an SVG draws it as an `<img>` instead of inline JSX. */
export type SvgImageReason = 'too_large' | 'stylesheet';
