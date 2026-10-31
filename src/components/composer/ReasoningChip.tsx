import { Suspense, lazy, startTransition, useRef, useState } from 'react';
import type { Placement } from '@floating-ui/react';
import { Brain } from '@droidex/icons';
import { offersReasoningEffort, reasoningEffortLabel } from '../../lib/reasoningEffort';
import type { ModelInfo, ProviderKind, ReasoningEffort } from '../../types/bridge';
import { Popover } from '../ui/Popover';

const loadReasoningPanel = () => import('./ReasoningPanel');
const ReasoningPanel = lazy(loadReasoningPanel);

function offersEffortChoice(model: ModelInfo | undefined): boolean {
  return offersReasoningEffort(model) && (model?.supportedReasoningEfforts?.length ?? 0) > 1;
}

/**
 * The composer's reasoning control beside the model chip: it names the level the
 * chat runs at and opens the effort slider for its model. A model with no
 * levels to pick between keeps it in place, dimmed, so the row does not shift
 * between models.
 */
export function ReasoningChip({
  appSessionId,
  model,
  effort,
  provider,
  placement,
}: {
  appSessionId: string | null;
  model: ModelInfo | undefined;
  /** The effort the chat shows, already resolved against its model. */
  effort: ReasoningEffort | undefined;
  provider: ProviderKind;
  placement: Placement;
}) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const canPick = offersEffortChoice(model);
  // A chat with no effort of its own runs at its model's default.
  const level = canPick ? (effort ?? model?.defaultReasoningEffort) : undefined;
  const levelLabel = level ? reasoningEffortLabel(level, provider) : undefined;
  const label = levelLabel ? `Reasoning: ${levelLabel}` : 'Reasoning';

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
        aria-label={label}
        title={canPick ? label : 'This model has no reasoning levels to choose'}
        onPointerEnter={() => {
          if (canPick) void loadReasoningPanel();
        }}
        onClick={() => {
          if (!canPick) return;
          // A transition lets the code-split panel render before the layer
          // shows, instead of Suspense holding its content back for 300ms.
          startTransition(() => {
            setOpen((value) => !value);
          });
        }}
        className={`flex h-control-sm shrink-0 items-center gap-1.5 rounded-md px-1.5 transition-colors ${tone}`}
      >
        <Brain className="size-icon-sm shrink-0" aria-hidden="true" />
        {levelLabel && (
          <span className={`capitalize ${level === 'ultra' ? 'text-ultra' : ''}`}>
            {levelLabel}
          </span>
        )}
      </button>
      <Suspense fallback={null}>
        <Popover
          open={open && canPick}
          onClose={() => {
            setOpen(false);
          }}
          anchorRef={chipRef}
          label="Reasoning"
          placement={placement}
        >
          <ReasoningPanel appSessionId={appSessionId} />
        </Popover>
      </Suspense>
    </>
  );
}
