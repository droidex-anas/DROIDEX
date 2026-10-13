import { useState } from 'react';
import { GripVertical, ListPlus, MousePointerSquareDashed, Pencil, X } from '@droidex/icons';
import type { QueuedPrompt } from '../../hooks/useStore';
import { formatResetTime } from '../../lib/usageLimit';
import type { UsageLimit } from '../../types/bridge';
import { Button } from '../ui/Button';
import { PendingPromptPreview } from './PendingPromptPreview';

function deliveryHint(usageLimit: UsageLimit | undefined): string {
  if (!usageLimit) return 'sends after the current turn';
  if (usageLimit.resetsAt === undefined) return 'held while the usage limit is reached';
  return `sends when the limit resets at ${formatResetTime(usageLimit.resetsAt, Date.now())}`;
}

// Prompts staged while the model is busy; they send one at a time after the
// current turn, or once the usage limit the chat is held on lifts. Rows are
// HTML5-draggable to reorder; the drag state lives here because nothing
// outside the list cares about an in-flight reorder.
export function QueuedPrompts({
  queue,
  usageLimit,
  onReorder,
  onEdit,
  onRemove,
}: {
  queue: QueuedPrompt[];
  usageLimit: UsageLimit | undefined;
  onReorder: (from: number, to: number) => void;
  onEdit: (prompt: QueuedPrompt) => void;
  onRemove: (id: string) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  if (queue.length === 0) return null;

  const handleDrop = (to: number) => {
    if (dragIndex !== null && dragIndex !== to) onReorder(dragIndex, to);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return (
    <div className="mb-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5 px-1 text-label text-muted">
        <ListPlus className="size-3" />
        Queued · {deliveryHint(usageLimit)}
      </div>
      {queue.map((p, i) => {
        return (
          <div
            key={p.id}
            draggable
            onDragStart={() => {
              setDragIndex(i);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(i);
            }}
            onDrop={() => {
              handleDrop(i);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setDragOverIndex(null);
            }}
            // A drop target gets the dashed outline, the one place a dashed line is allowed.
            className={`group flex items-start gap-2 rounded-lg bg-elevated px-2 py-1.5 transition-colors ${
              dragOverIndex === i && dragIndex !== null && dragIndex !== i
                ? 'outline-dashed outline-1 outline-divider-strong'
                : ''
            }`}
          >
            <span
              className="flex h-control-sm cursor-grab items-center text-muted active:cursor-grabbing"
              title="Drag to reorder"
            >
              <GripVertical className="size-icon-sm" />
            </span>
            <PendingPromptPreview text={p.text} files={p.files} skills={p.skills}>
              {p.design && p.design.references.length > 0 && (
                <span className="mt-1 inline-flex items-center gap-1 rounded-sm bg-active px-1.5 py-0.5 text-caption text-muted">
                  <MousePointerSquareDashed className="size-3" />
                  {p.design.references.length} reference
                  {p.design.references.length === 1 ? '' : 's'}
                </span>
              )}
            </PendingPromptPreview>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                icon={Pencil}
                aria-label="Edit in composer"
                title="Edit in composer"
                onClick={() => {
                  onEdit(p);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                icon={X}
                aria-label="Delete"
                title="Delete"
                onClick={() => {
                  onRemove(p.id);
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
