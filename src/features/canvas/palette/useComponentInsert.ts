// Where the Components tab adds a kit entry, and the add itself: after the
// entry it added last, else into the layer Edit has picked, else into the top
// layer of the one selected frame. An add is written only where the frame's
// preview would show it, and the board then brings that spot into view. Once
// it has built, its layer is picked in Edit, so the next entry goes in after it.

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import type { CanvasPresence } from '../canvasPresence';
import type { LayerRef, PropPick } from '../elementEditProtocol';
import type { LayerElements } from '../layers/layerElements';
import { drawnLayers } from '../layers/drawnLayers';
import type { EditLayer } from '../layers/useLayerEdit';
import { pickedLayer, type PickedLayer } from '../pickedElement';
import type { PreviewNode } from '../previewDocument';
import type { PreviewLanding } from '../previewDocumentLanding';
import type { PreviewRuns } from '../previewRuns';
import type { PreviewRun } from '../previewRuntime';
import type { CanvasFrame, ElementRef, FrameRect, OutlineNode, SourceOutline } from '../protocol';
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

/** Why the last add at one layer of one revision was not written. */
interface Refusal extends PalettePlace {
  layerKey: string;
}

const UNSEEN = 'Not added: it would land where this frame doesn’t show. Pick a layer to add it to.';
const UNREAD = 'Can’t tell where it would show. Bring the frame into view and add again.';

export function useComponentInsert({
  frames,
  selectedFrameIds,
  elements,
  presence,
  onEditLayer,
  reveal,
}: {
  /** The frames on the board, which Edit picks in. */
  frames: readonly CanvasFrame[];
  selectedFrameIds: readonly string[];
  /** The board's elements: the one Edit has picked, and the previews an added one is picked in. */
  elements: LayerElements;
  presence: CanvasPresence;
  /** Undefined where this chat cannot change the canvas. */
  onEditLayer: EditLayer | undefined;
  /** Brings a rect of the board into view. */
  reveal: (rect: FrameRect) => void;
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
    const into = target.layer.row;
    const layer = { designId: frame.designId, revisionId, nodeId: into.nodeId };
    const layerKey = layerKeyOf(layer);
    const pick = picked?.pick ?? null;
    setAdding(true);
    void (async () => {
      const landing = await landingFor(elements.runs, frame, revisionId, into);
      if (landing === null || landing === 'unseen') {
        setAdding(false);
        setRefusal(
          landing === null
            ? { layerKey, hint: UNREAD, canAdd: true }
            : { layerKey, hint: UNSEEN, canAdd: false },
        );
        return;
      }
      const edited = await onEditLayer(layer, { kind: 'insert', entry, props });
      setAdding(false);
      if (!edited?.landed) return;
      setAdded({
        designId: frame.designId,
        revisionId: edited.receipt.revisionId,
        nodeId: edited.landed,
        pick,
      });
      // The rest of the frame from where the entry starts; one larger than the board shows that corner.
      reveal({
        x: frame.rect.x + landing.x,
        y: frame.rect.y + landing.y,
        width: frame.rect.width - landing.x,
        height: frame.rect.height - landing.y,
      });
    })();
  };
  return { kit: (target?.frame ?? frames.at(0))?.designSystem, place, add };
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
  if (refusal?.layerKey === layerKey) return { hint: refusal.hint, canAdd: refusal.canAdd };
  const landing = landingOf(outline.nodes, target.layer.row);
  return { hint: landingHint(landing), canAdd: landing.kind !== 'refused' };
}

/**
 * Where the frame's preview of `revisionId` would start an entry added at
 * `row`, or null when it cannot tell. A row with no element of its own, a
 * component's usage, is probed at the end of the nearest element holding it,
 * which is where an add that went in last there left it.
 */
async function landingFor(
  runs: PreviewRuns,
  frame: CanvasFrame,
  revisionId: string,
  row: OutlineNode,
): Promise<PreviewLanding | null> {
  const held = runs.get(frame.designId);
  const outline = builtOutline(frame);
  if (!outline || held?.revisionId !== revisionId) return null;
  const tree = await held.run.tree(null);
  const landing = landingOf(outline.nodes, row);
  if (!tree || landing.kind === 'refused') return null;
  const { drawn } = drawnLayers(outline, tree);
  const own = drawn.get(row.nodeId);
  if (own?.state === 'drawn') return held.run.landing(own.node, landing.kind);
  if (landing.kind === 'inside') return null;
  const byId = new Map(outline.nodes.map((node) => [node.nodeId, node]));
  for (let at = byId.get(row.parentId ?? ''); at; at = byId.get(at.parentId ?? '')) {
    const holder = drawn.get(at.nodeId);
    if (holder?.state === 'drawn') return held.run.landing(holder.node, 'inside');
  }
  return null;
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
