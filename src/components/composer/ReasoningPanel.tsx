import { useMemo, useRef } from 'react';
import { isReasoningEffort } from '../../lib/reasoningEffort';
import EffortSlider from '../effortSlider/EffortSlider';
import { CARD_SLIDER_STYLE, effortSliderLevels } from '../effortSlider/effortSliderCard';
import { effortsFor } from '../ModelCatalogList';
import useModelPicker from '../useModelPicker';

const WIDTH_PX = 280;
// Inside the window's 8px floating-layer margin on both sides.
const MAX_WIDTH = 'calc(100vw - 16px)';

// The effort slider on its own, for the chat's current model.
export default function ReasoningPanel({ appSessionId }: { appSessionId: string | null }) {
  const { provider, activeModel, effReasoning, updateReasoning } = useModelPicker({
    appSessionId,
    singleAgent: true,
  });
  const panelRef = useRef<HTMLDivElement>(null);
  const efforts = effortsFor(activeModel, effReasoning);
  const levels = useMemo(() => effortSliderLevels(efforts, provider), [efforts, provider]);
  // An unset effort is provider-managed; the slider sits on the model's default.
  const shown = effReasoning ?? activeModel?.defaultReasoningEffort;
  const value = shown !== undefined && efforts.includes(shown) ? shown : efforts.at(-1);

  return (
    <div ref={panelRef} style={{ width: WIDTH_PX, maxWidth: MAX_WIDTH }} className="px-3 pt-1 pb-3">
      {value !== undefined && (
        <EffortSlider
          levels={levels}
          value={value}
          autoFocus
          onCommit={(next) => {
            if (isReasoningEffort(next)) updateReasoning(next);
          }}
          style={CARD_SLIDER_STYLE}
          helpAnchor={panelRef}
        />
      )}
    </div>
  );
}
