import { picksElements, reduceBoardInteraction, type BoardInteraction } from '../canvasState';
import type { PreviewNode } from '../previewDocument';
import type { OverlayStore } from '../overlayStore';
import type { PreviewRuns } from '../previewRuns';
import type { ElementRef } from '../protocol';
import type { ElementEditor } from '../useElementEditor';
import type { HoveredElement } from '../useElementHover';

/** The board's elements, as the layers panel reads and picks them. */
export interface LayerElements {
  /** Each shown frame's live preview, which an open frame's elements are read from. */
  runs: PreviewRuns;
  /** The element Edit has picked, whose row shows as selected, and which pick chose it, counting from the board's first. */
  picked: { element: ElementRef; pick: number } | null;
  /** The element under the board's pointer, whose row lights. */
  hovered: OverlayStore<HoveredElement | null>;
  /** Picks the element in Edit, entering Edit from any other mode. */
  pick: (designId: string, node: PreviewNode) => void;
  /** Outlines the element on the board as the pointer over it would; null puts that out. */
  hover: (designId: string, node: PreviewNode | null) => void;
}

/** The elements of a board whose Edit runs `editor` over `runs`, in `interaction`. */
export function layerElements(
  runs: PreviewRuns,
  editor: ElementEditor,
  interaction: BoardInteraction,
  onInteractionChange: (next: BoardInteraction) => void,
): LayerElements {
  return {
    runs,
    picked: editor.selection && { element: editor.selection.draft.element, pick: editor.picks },
    hovered: editor.hover.hovered,
    pick: (designId, node) => {
      if (interaction.mode !== 'edit')
        onInteractionChange(reduceBoardInteraction(interaction, { type: 'edit' }));
      editor.pick(designId, node);
    },
    hover: (designId, node) => {
      // Only the modes that point at elements outline the one under the pointer.
      if (node && picksElements(interaction.mode)) editor.hover.move(designId, node);
      else editor.hover.clear();
    },
  };
}
