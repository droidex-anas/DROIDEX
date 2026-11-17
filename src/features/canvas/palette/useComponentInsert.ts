// Where the Components tab adds a kit entry, and the add itself: after the
// entry it added last, else into the layer Edit has picked, else into the top
// layer of the one selected frame. An add is a step of the board's history as
// soon as it lands, and stays only where the frame shows it: the elements the
// row it landed on drew are measured in the revision it made, and an add the
// frame does not show is taken back with its step. One that stays is brought
// into view and picked in Edit, so the next entry goes after it.

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from '../../../lib/toast';
import type { HeldStep } from '../boardHistory';
import type { CanvasPresence } from '../canvasPresence';
import type { ElementEdited, LayerRef, PropPick } from '../elementEditProtocol';
import type { LayerElements } from '../layers/layerElements';
import { drawnLayers } from '../layers/drawnLayers';
import type { EditLayer } from '../layers/useLayerEdit';
import { pickedLayer, type PickedLayer } from '../pickedElement';
import type { PreviewNode } from '../previewDocument';
import type { PreviewRuns } from '../previewRuns';
import type { PreviewRun } from '../previewRuntime';
import type { CanvasFrame, ElementRef, FrameRect, SourceOutline } from '../protocol';
import { landingHint, landingOf } from './paletteRows';

/** The row an add landed on, in the revision it made. */
interface Added {
  designId: string;
  revisionId: string;
  nodeId: string;
  /** Edit's pick count when it was added; a pick after it goes back to the picked layer. */
  pick: number | null;
}

interface Target {
  frame: CanvasFrame;
  revisionId: string;
  /** Null until the frame has built the revision. */
  layer: PickedLayer | null;
}

/** What the tab says of where an entry goes, and whether one can go there now. */
export interface PalettePlace {
  hint: string;
  canAdd: boolean;
}

/** How an add becomes a step of the board's history, and is taken back with it. */
export interface AddSteps {
  /** Holds the add that moved `layer`'s design to `made` as a step; null where none is recorded. */
  record: (layer: LayerRef, made: string) => HeldStep | null;
  /** Runs an add with Undo and Redo held off until it stays or is taken back. */
  holding: <Answer>(add: () => Promise<Answer>) => Promise<Answer>;
}

/** Why the last add at one layer of one revision did not stay. */
interface Refusal {
  layerKey: string;
  hint: string;
}

/** How an add ended: it stays and shows there, it did not stay and why, or it was never written. */
type AddOutcome =
  | { kind: 'shown'; revisionId: string; nodeId: string; box: FrameRect }
  | { kind: 'refused'; hint: string }
  | { kind: 'failed' };

const UNSEEN =
  'Not added: this frame would cut it off or hide it there. Pick a layer to add it to.';
const UNREAD =
  'Not added: can’t tell whether this frame would show it. Bring the frame into view and add again.';
/** A frame builds the revision an add made before drawing it, which takes seconds. */
const DRAWN_DEADLINE_MS = 20_000;

export function useComponentInsert({
  frames,
  selectedFrameIds,
  elements,
  presence,
  onEditLayer,
  steps,
  holdReveal,
}: {
  /** The frames on the board, which Edit picks in. */
  frames: readonly CanvasFrame[];
  selectedFrameIds: readonly string[];
  /** The board's elements: the one Edit has picked, and the previews an add is measured and picked in. */
  elements: LayerElements;
  presence: CanvasPresence;
  /** Undefined where this chat cannot change the canvas. */
  onEditLayer: EditLayer | undefined;
  steps: AddSteps;
  /** The board's reveal from where it is now, which does nothing once the user has moved it. */
  holdReveal: () => ((rect: FrameRect) => void) | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const picked = elements.picked;
  // A pick since the add, or another frame selected, takes the next entry elsewhere.
  if (
    added &&
    ((picked && picked.pick !== added.pick) ||
      selectedFrameIds.some((designId) => designId !== added.designId))
  )
    setAdded(null);
  const target = targetOf(frames, selectedFrameIds, picked?.element ?? null, added);
  const place = placeOf(target, { adding, presence, canEdit: onEditLayer !== undefined, refusal });
  usePickAdded(added, frames, elements);

  const add = (entry: string, props: PropPick[]) => {
    if (!target?.layer || !('row' in target.layer) || !onEditLayer || !place.canAdd) return;
    const { frame, revisionId } = target;
    const layer = { designId: frame.designId, revisionId, nodeId: target.layer.row.nodeId };
    const pick = picked?.pick ?? null;
    const reveal = holdReveal();
    setAdding(true);
    const write = () => onEditLayer(layer, { kind: 'insert', entry, props });
    void steps
      .holding(() => addWhereShown(elements.runs, layer, write, steps))
      .then((outcome) => {
        setAdding(false);
        if (outcome.kind === 'failed') return;
        if (outcome.kind === 'refused') {
          setRefusal({ layerKey: layerKeyOf(layer), hint: outcome.hint });
          return;
        }
        const { box } = outcome;
        setRefusal(null);
        setAdded({
          designId: frame.designId,
          revisionId: outcome.revisionId,
          nodeId: outcome.nodeId,
          pick,
        });
        reveal?.({ ...box, x: frame.rect.x + box.x, y: frame.rect.y + box.y });
      });
  };
  return { kit: (target?.frame ?? frames.at(0))?.designSystem, place, add };
}

/**
 * Writes an add, makes it a step as it lands, and keeps it only where the
 * frame's preview of the revision it made shows the elements the row it
 * landed on drew. One it cannot measure is taken back too.
 */
async function addWhereShown(
  runs: PreviewRuns,
  layer: LayerRef,
  write: () => Promise<ElementEdited | null>,
  steps: AddSteps,
): Promise<AddOutcome> {
  // A frame whose preview is not drawing it could not say, so nothing is written.
  if (runs.get(layer.designId)?.revisionId !== layer.revisionId)
    return { kind: 'refused', hint: UNREAD };
  const edited = await write();
  if (!edited) return { kind: 'failed' };
  const step = steps.record(layer, edited.receipt.revisionId);
  const verdict = await verdictOf(runs, layer.designId, edited);
  if (verdict.kind === 'shown') {
    step?.keep();
    return verdict;
  }
  if (step && (await step.takeBack().catch(() => false))) return verdict;
  // The frame changed meanwhile, so the add stays as the step it was recorded as.
  toast.error('Added where this frame doesn’t show it. Undo takes it back.');
  return { kind: 'failed' };
}

/** Where the preview of the revision an add made shows the row it landed on, or why it does not. */
async function verdictOf(
  runs: PreviewRuns,
  designId: string,
  { receipt, landed }: ElementEdited,
): Promise<Exclude<AddOutcome, { kind: 'failed' }>> {
  if (landed === null) return { kind: 'refused', hint: UNREAD };
  const run = await drawnRun(runs, designId, receipt.revisionId);
  const shown = run ? await run.shown(landed).catch(() => null) : null;
  if (shown === null) return { kind: 'refused', hint: UNREAD };
  if (shown === 'unseen') return { kind: 'refused', hint: UNSEEN };
  return { kind: 'shown', revisionId: receipt.revisionId, nodeId: landed, box: shown };
}

/** The design's preview once it draws `revisionId`, or null when it has not by the deadline. */
function drawnRun(
  runs: PreviewRuns,
  designId: string,
  revisionId: string,
): Promise<PreviewRun | null> {
  return new Promise((resolve) => {
    const settle = (run: PreviewRun | null) => {
      clearTimeout(deadline);
      stopListening();
      resolve(run);
    };
    const check = () => {
      const held = runs.get(designId);
      if (held?.revisionId === revisionId) settle(held.run);
    };
    const deadline = setTimeout(() => {
      settle(null);
    }, DRAWN_DEADLINE_MS);
    const stopListening = runs.subscribe(check);
    check();
  });
}

function targetOf(
  frames: readonly CanvasFrame[],
  selectedFrameIds: readonly string[],
  picked: ElementRef | null,
  added: Added | null,
): Target | null {
  const frameOf = (designId: string) => frames.find((frame) => frame.designId === designId);
  // The added layer stays the target while its frame shows that revision.
  const addedFrame = added && frameOf(added.designId);
  if (added && addedFrame?.revisionId === added.revisionId)
    return {
      frame: addedFrame,
      revisionId: added.revisionId,
      layer: rowOf(addedFrame, added.nodeId),
    };
  if (picked) {
    const frame = frameOf(picked.designId);
    if (!frame) return null;
    const layer = pickedLayer(frame, picked.revisionId, picked.elementId) ?? null;
    return { frame, revisionId: picked.revisionId, layer };
  }
  const frame = selectedFrameIds.length === 1 ? frameOf(selectedFrameIds[0]) : undefined;
  if (!frame?.revisionId) return null;
  return { frame, revisionId: frame.revisionId, layer: rowOf(frame, null) };
}

/** The row `nodeId` of the frame's built outline, or for null its top layer. */
function rowOf(frame: CanvasFrame, nodeId: string | null): PickedLayer | null {
  const nodes = builtOutline(frame)?.nodes ?? [];
  const row = nodes.find((node) =>
    nodeId === null ? node.parentId === null : node.nodeId === nodeId,
  );
  return row ? { row } : null;
}

/** A refusal holds for the one layer of the one revision it was asked of. */
function layerKeyOf({ designId, revisionId, nodeId }: LayerRef): string {
  return `${designId}:${revisionId}:${nodeId}`;
}

function placeOf(
  target: Target | null,
  {
    adding,
    presence,
    canEdit,
    refusal,
  }: { adding: boolean; presence: CanvasPresence; canEdit: boolean; refusal: Refusal | null },
): PalettePlace {
  const refuse = (hint: string) => ({ hint, canAdd: false });
  if (!target) return refuse('Select a frame or a layer to add to.');
  if (!canEdit) return refuse('This chat can’t change this canvas.');
  if (adding) return refuse('Adding…');
  if (presence.has(target.frame.designId))
    return refuse('The agent is writing this frame. Add once it’s done.');
  const outline = builtOutline(target.frame);
  if (!target.layer || !outline) return refuse('Wait until this frame has built.');
  if ('refusal' in target.layer)
    return refuse(
      'Can’t tell this element from the component that draws it. Pick its layer in Layers.',
    );
  const { designId } = target.frame;
  const layerKey = layerKeyOf({
    designId,
    revisionId: target.revisionId,
    nodeId: target.layer.row.nodeId,
  });
  const landing = landingOf(outline.nodes, target.layer.row);
  if (landing.kind === 'refused') return refuse(landing.reason);
  // The frame may show the next add there, once it is scrolled or picked otherwise.
  if (refusal?.layerKey === layerKey) return { hint: refusal.hint, canAdd: true };
  return { hint: landingHint(landing), canAdd: true };
}

/** The outline of the revision the frame shows, once it has built. */
function builtOutline(frame: CanvasFrame): SourceOutline | undefined {
  const { build } = frame;
  return build.status === 'ready' && build.revisionId === frame.revisionId
    ? build.outline
    : undefined;
}

/**
 * Picks the added layer in Edit once its frame's preview draws that revision.
 * A component's usage has no element of its own to pick, as in Layers, so it
 * stays the target unpicked.
 */
function usePickAdded(
  added: Added | null,
  frames: readonly CanvasFrame[],
  elements: LayerElements,
) {
  const { runs } = elements;
  const readVersion = () => runs.version;
  const version = useSyncExternalStore(runs.subscribe, readVersion, readVersion);
  /** The add and the run its pick asked, so a later render does not ask again. */
  const asked = useRef<{ added: Added; run: PreviewRun } | null>(null);
  const pick = useEffectEvent((designId: string, node: PreviewNode) => {
    elements.pick(designId, node);
  });
  useEffect(() => {
    // A tree read asked for the add picks nothing once the add is dropped, or
    // once its frame or preview moves on from the revision it made.
    if (!added) {
      asked.current = null;
      return;
    }
    const frame = frames.find((each) => each.designId === added.designId);
    const outline = frame?.revisionId === added.revisionId ? builtOutline(frame) : undefined;
    const held = runs.get(added.designId);
    if (!outline || held?.revisionId !== added.revisionId) {
      asked.current = null;
      return;
    }
    if (asked.current?.added === added && asked.current.run === held.run) return;
    const asking = { added, run: held.run };
    asked.current = asking;
    const row = outline.nodes.find((node) => node.nodeId === added.nodeId);
    if (row?.kind !== 'element') return;
    void held.run.tree(null).then((tree) => {
      if (asked.current !== asking || !tree) return;
      const drawn = drawnLayers(outline, tree).drawn.get(row.nodeId);
      if (drawn?.state === 'drawn') pick(added.designId, drawn.node);
    });
  }, [added, frames, runs, version]);
}
