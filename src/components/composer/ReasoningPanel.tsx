import { useMemo, useRef } from 'react';
import { isReasoningEffort } from '../../lib/reasoningEffort';
import { fastModeBlockedReason, offersFastMode } from '../../lib/fastMode';
import {
  contextWindowOptions,
  offersContextWindow,
  unpinnedContextWindow,
} from '../../lib/contextWindow';
import useContextWindow from '../../hooks/useContextWindow';
import ContextWindowMenu from '../ContextWindowMenu';
import EffortSlider from '../effortSlider/EffortSlider';
import { CARD_SLIDER_STYLE, effortSliderLevels } from '../effortSlider/effortSliderCard';
import { FastModeToggle } from '../FastModeToggle';
import { effortsFor } from '../ModelCatalogList';
import useModelPicker from '../useModelPicker';

const WIDTH_PX = 280;
// Inside the window's 8px floating-layer margin on both sides.
const MAX_WIDTH = 'calc(100vw - 16px)';

// The effort slider for the chat's current model, with the harness's fast mode
// and context window when it offers them: how the model runs, apart from which.
export default function ReasoningPanel({ appSessionId }: { appSessionId: string | null }) {
  const {
    provider,
    providerStatuses,
    activeModel,
    effReasoning,
    fastMode,
    setFastMode,
    scopedAppSessionId,
    updateReasoning,
  } = useModelPicker({ appSessionId, singleAgent: true });
  const { contextWindowTokens, providerWindow, setContextWindow } =
    useContextWindow(scopedAppSessionId);
  const panelRef = useRef<HTMLDivElement>(null);
  const efforts = effortsFor(activeModel, effReasoning);
  const levels = useMemo(() => effortSliderLevels(efforts, provider), [efforts, provider]);
  // An unset effort is provider-managed; the slider sits on the model's default.
  const shown = effReasoning ?? activeModel?.defaultReasoningEffort;
  const value = shown !== undefined && efforts.includes(shown) ? shown : efforts.at(-1);
  const showsFastMode = offersFastMode(provider);
  const showsContextWindow = offersContextWindow(provider);

  return (
    <div ref={panelRef} style={{ width: WIDTH_PX, maxWidth: MAX_WIDTH }} className="px-3 pt-1 pb-3">
      {(showsFastMode || showsContextWindow) && (
        <div className="flex h-8 items-center gap-1.5">
          {showsFastMode && (
            <FastModeToggle
              on={fastMode}
              blockedReason={fastModeBlockedReason(activeModel)}
              onToggle={setFastMode}
            />
          )}
          {showsContextWindow && (
            <div className="ml-auto">
              <ContextWindowMenu
                options={contextWindowOptions(
                  activeModel,
                  unpinnedContextWindow(
                    providerWindow,
                    activeModel,
                    providerStatuses.find((entry) => entry.provider === provider),
                  ),
                )}
                selected={contextWindowTokens}
                onSelect={setContextWindow}
              />
            </div>
          )}
        </div>
      )}
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
