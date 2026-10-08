import { useState } from 'react';
import { GripVertical, ListPlus, Pencil, X } from 'lucide-react';
import type { QueuedPrompt } from '../../hooks/useStore';
import { formatResetTime } from '../../lib/usageLimit';
import type { UsageLimit } from '../../types/bridge';
import { browserTranscriptReferencesFromDesignReferences } from '../browser/browserTranscriptReferences';
import { BrowserReferenceChip } from '../browser/BrowserReferenceChip';
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
      <div className="flex items-center gap-1.5 px-1 text-[11px] font-medium tracking-wide text-droid-text-muted">
        <ListPlus className="w-3 h-3" />
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
            className={`group flex items-start gap-2 rounded-xl border bg-droid-elevated px-2 py-1.5 transition-colors ${
              dragOverIndex === i && dragIndex !== null && dragIndex !== i
                ? 'border-droid-orange'
                : 'border-droid-border'
            }`}
          >
            <span
              className="mt-0.5 cursor-grab text-droid-text-muted/60 active:cursor-grabbing"
              title="Drag to reorder"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </span>
            <PendingPromptPreview text={p.text} files={p.files} skills={p.skills}>
              {p.design && <QueuedDesignReferences prompt={p} />}
            </PendingPromptPreview>
            <div className="flex shrink-0 items-center gap-0.5">
              {!p.design && (
                <button
                  onClick={() => {
                    onEdit(p);
                  }}
                  className="rounded p-1 text-droid-text-muted transition-colors hover:bg-droid-active/70 hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
                  title="Edit in composer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                onClick={() => {
                  onRemove(p.id);
                }}
                className="rounded p-1 text-droid-text-muted transition-colors hover:bg-droid-active/70 hover:text-droid-red focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60"
                title="Delete"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function QueuedDesignReferences({ prompt }: { prompt: QueuedPrompt }) {
  if (!prompt.design || prompt.design.references.length === 0) return null;
  const references = browserTranscriptReferencesFromDesignReferences(prompt.design.references);
  if (references.length === 0) return null;

  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {references.map((reference) => (
        <BrowserReferenceChip key={`${reference.kind}:${reference.id}`} reference={reference} />
      ))}
    </span>
  );
}
