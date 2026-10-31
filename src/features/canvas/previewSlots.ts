// Which frames hold a live `<webview>` preview. Spec §11 budgets at most four,
// so the board hands out four slots and every other frame shows a quiet
// placeholder. The policy is pure: the board measures what is visible and what
// the user is holding, and this decides.
//
// Losing a slot stops the guest, which resets whatever transient state that
// design's components held — a half-filled form, a counter, an open menu. The
// source and the layout are durable, so the design comes back; what it cannot
// bring back is where the user had got to inside it. A released frame therefore
// says so, instead of silently reloading when it returns.

/** Spec §11: at most four live previews on a board, measured at 50 frames. */
export const MAX_LIVE_PREVIEWS = 4;

export interface PreviewSlots {
  /** The frames whose previews are mounted, in the order they claimed a slot. */
  live: string[];
  /** Frames that held a slot and lost it; their previews reload on return. */
  released: string[];
}

export const NO_PREVIEW_SLOTS: PreviewSlots = { live: [], released: [] };

export interface PreviewSlotRequest {
  /** Every frame the canvas still has, so a deleted design is forgotten. */
  designIds: readonly string[];
  /** Frames inside the board's own box, nearest its centre first. */
  visible: readonly string[];
  /** The frame Interact is driving, which keeps its slot wherever it is. */
  interacted: string | null;
  selected: readonly string[];
}

/**
 * The four frames that should be live. Priority runs: the interacted frame,
 * then selected frames the user can see, then frames already live and still
 * visible — keeping a mounted preview mounted is worth more than mounting a
 * nearer one — then the rest of what is visible.
 */
export function reducePreviewSlots(slots: PreviewSlots, request: PreviewSlotRequest): PreviewSlots {
  const exists = new Set(request.designIds);
  const visible = request.visible.filter((id) => exists.has(id));
  const claims = [
    request.interacted !== null && exists.has(request.interacted) ? [request.interacted] : [],
    visible.filter((id) => request.selected.includes(id)),
    visible.filter((id) => slots.live.includes(id)),
    visible,
  ].flat();

  const live: string[] = [];
  for (const designId of claims) {
    if (live.length === MAX_LIVE_PREVIEWS) break;
    if (!live.includes(designId)) live.push(designId);
  }

  const mounted = new Set(live);
  const released = [...new Set([...slots.released, ...slots.live])].filter(
    (id) => exists.has(id) && !mounted.has(id),
  );
  return same(slots.live, live) && same(slots.released, released) ? slots : { live, released };
}

function same(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}
