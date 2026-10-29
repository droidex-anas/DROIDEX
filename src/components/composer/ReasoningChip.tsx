import { Suspense, lazy, useRef, useState } from 'react';
import { Brain } from '@droidex/icons';
import { offersReasoningEffort, reasoningEffortLabel } from '../../lib/reasoningEffort';
import type { ModelInfo, ProviderKind, ReasoningEffort } from '../../types/bridge';
import { Popover } from '../ui/Popover';

const loadReasoningPanel = () => import('./ReasoningPanel');
const ReasoningPanel = lazy(loadReasoningPanel);

/**
 * Design's reasoning control beside the model chip: it names the chat's effort
 * and opens the effort slider for its model. A model with no levels to pick
 * between keeps it in place, dimmed, so the row does not shift between models.
 */
export function ReasoningChip({
  appSessionId,
  model,
  effort,
  provider,
}: {
  appSessionId: string | null;
  model: ModelInfo | undefined;
  /** The effort the chat shows, already resolved against its model. */
  effort: ReasoningEffort | undefined;
  provider: ProviderKind;
}) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const canPick =
    offersReasoningEffort(model) && (model?.supportedReasoningEfforts?.length ?? 0) > 1;
  const label = effort ? reasoningEffortLabel(effort, provider) : 'Default';

  let tone = 'text-secondary hover:bg-active/60 hover:text-primary';
  if (open) tone = 'bg-active text-primary';
  else if (!canPick) tone = 'cursor-default text-muted opacity-60';

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        aria-disabled={!canPick || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={canPick ? `Reasoning: ${label}` : 'Reasoning'}
        title={canPick ? `Reasoning: ${label}` : 'This model has no reasoning levels to choose'}
        onPointerEnter={() => {
          if (canPick) void loadReasoningPanel();
        }}
        onClick={() => {
          if (canPick) setOpen((value) => !value);
        }}
        className={`flex h-control-sm shrink-0 items-center gap-1.5 rounded-md px-1.5 transition-colors ${tone}`}
      >
        <Brain className="size-icon-sm shrink-0" aria-hidden="true" />
        {canPick && (
          <span className={`capitalize ${effort === 'ultra' ? 'text-ultra' : ''}`}>{label}</span>
        )}
      </button>
      <Popover
        open={open && canPick}
        onClose={() => {
          setOpen(false);
        }}
        anchorRef={chipRef}
        label="Reasoning"
        placement="top-end"
      >
        <Suspense fallback={null}>
          <ReasoningPanel appSessionId={appSessionId} />
        </Suspense>
      </Popover>
    </>
  );
}
