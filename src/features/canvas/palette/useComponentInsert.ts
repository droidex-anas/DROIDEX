// Where the Components tab adds a kit entry, and the add itself: after the
// entry it added last, else into the layer Edit has picked, else into the top
// layer of the one selected frame. Once an add has built, its layer is picked
// in Edit, so the next entry goes in after it.

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import type { CanvasPresence } from '../canvasPresence';
import type { LayerElements } from '../layers/layerElements';
import { drawnLayers } from '../layers/drawnLayers';
import type { EditLayer } from '../layers/useLayerEdit';
import { pickedLayer, type PickedLayer } from '../pickedElement';
import type { PreviewNode } from '../previewDocument';
import type { PreviewRun } from '../previewRuntime';
import type { CanvasFrame, ElementRef, SourceOutline } from '../protocol';
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

export function useComponentInsert({
  frames,
  selectedFrameIds,
  elements,
  presence,
  onEditLayer,
}: {
  /** The frames on the board, which Edit picks in. */
  frames: readonly CanvasFrame[];
  selectedFrameIds: readonly string[];
  /** The board's elements: the one Edit has picked, and the previews an added one is picked in. */
  elements: LayerElements;
  presence: CanvasPresence;
  /** Undefined where this chat cannot change the canvas. */
  onEditLayer: EditLayer | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Added | null>(null);
  const picked = elements.picked;
  // A pick since the add, or another frame selected, takes the next entry elsewhere.
  if (
    added &&
    ((picked && picked.pick !== added.pick) ||
      selectedFrameIds.some((designId) => designId !== added.designId))
  )
    setAdded(null);
  const target = targetOf(frames, selectedFrameIds, picked?.element ?? null, added);
  const place = placeOf(target, { adding, presence, canEdit: onEditLayer !== undefined });
  usePickAdded(added, frames, elements);

  const add = (entry: string) => {
    if (!target?.layer || !('row' in target.layer) || !onEditLayer || !place.canAdd) return;
    const { designId } = target.frame;
    setAdding(true);
    const layer = { designId, revisionId: target.revisionId, nodeId: target.layer.row.nodeId };
    const pick = picked?.pick ?? null;
    void onEditLayer(layer, { kind: 'insert', entry }).then((edited) => {
      setAdding(false);
      if (edited?.landed)
        setAdded({ designId, revisionId: edited.receipt.revisionId, nodeId: edited.landed, pick });
    });
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

function placeOf(
  target: Target | null,
  { adding, presence, canEdit }: { adding: boolean; presence: CanvasPresence; canEdit: boolean },
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
  const landing = landingOf(outline.nodes, target.layer.row);
  return { hint: landingHint(landing), canAdd: landing.kind !== 'refused' };
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
