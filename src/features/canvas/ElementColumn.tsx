// Edit's element column beside the board: the picked element's panel, or the
// prompt to pick one while Edit has nothing picked.

import type { HistoryStep } from './boardHistory';
import { ElementPanel, EmptyElementPanel } from './ElementPanel';
import type { CanvasFrame } from './protocol';
import type { useElementEditor } from './useElementEditor';

export function ElementColumn({
  editor,
  frames,
  editing,
  onHistory,
  onLeave,
}: {
  editor: ReturnType<typeof useElementEditor>;
  frames: readonly CanvasFrame[];
  /** The board is in Edit, so the column stands even with nothing picked. */
  editing: boolean;
  onHistory: (step: HistoryStep) => boolean;
  /** Escape from the panel hands the keyboard to the board. */
  onLeave: () => void;
}) {
  const { selection } = editor;
  if (!selection) return editing ? <EmptyElementPanel /> : null;
  return (
    <ElementPanel
      ref={editor.panel}
      selection={selection}
      frameName={
        frames.find((frame) => frame.designId === selection.draft.element.designId)?.name ?? ''
      }
      tokens={editor.tokens}
      mode={editor.mode}
      onPreview={editor.preview}
      onRevert={editor.revert}
      onCommit={editor.commit}
      onPreviewText={editor.previewText}
      onRevertText={editor.revertText}
      onCommitText={editor.commitText}
      onHistory={onHistory}
      onLeave={onLeave}
    />
  );
}
