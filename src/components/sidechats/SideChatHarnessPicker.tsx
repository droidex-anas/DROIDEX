import { useRef, useState } from 'react';
import { ChevronDown } from '@droidex/icons';
import { shallowEqual, useStoreSelector } from '../../hooks/useStore';
import HarnessSegments from '../../features/providers/HarnessSegments';
import {
  PROVIDER_LABELS,
  PROVIDER_MARKS,
  providerDefaultModel,
  providerModelCatalog,
} from '../../features/providers/providerIdentity';
import { Popover } from '../ui/Popover';
import type { SideChatHarness } from '../../lib/sideChats';
import ModelCatalogList from '../ModelCatalogList';
import { ModelIcon } from '../ModelIcon';

/* Which harness and model a new side chat runs on. Any harness can answer a
   question about any chat: another harness is handed the transcript. */

export function SideChatHarnessPicker({
  settings,
  onChange,
}: {
  // What the side chat will run on, defaults already resolved.
  settings: SideChatHarness;
  onChange: (harness: SideChatHarness) => void;
}) {
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const { droidModels, statuses } = useStoreSelector(
    (state) => ({ droidModels: state.models, statuses: state.providerStatuses }),
    shallowEqual,
  );
  const { provider, modelId, reasoningEffort } = settings;
  const catalog = providerModelCatalog(provider, droidModels, statuses);
  const model = modelId
    ? catalog.find((entry) => entry.id === modelId)
    : providerDefaultModel(provider, catalog, statuses);
  const label = model?.displayName ?? modelId ?? PROVIDER_LABELS[provider];

  return (
    <>
      <button
        ref={chipRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Side chat model: ${label}`}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className={`flex h-7 max-w-full items-center gap-1.5 rounded-md px-2 text-[12px] text-secondary transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/40 ${
          open ? 'bg-elevated text-primary' : ''
        }`}
      >
        <ModelIcon provider={PROVIDER_MARKS[provider]} size={13} />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted" />
      </button>
      <Popover
        open={open}
        anchorRef={chipRef}
        onClose={() => {
          setOpen(false);
        }}
        label="Side chat harness and model"
        placement="bottom-start"
        width={320}
      >
        <HarnessSegments
          provider={provider}
          statuses={statuses}
          locked={false}
          onSelect={(kind) => {
            onChange({ provider: kind });
          }}
        />
        <div className="px-2 pb-2 pt-2">
          <ModelCatalogList
            models={catalog}
            hasRealModels={catalog.length > 0}
            provider={provider}
            selectedModelId={model?.id}
            reasoning={reasoningEffort}
            query=""
            onSelectModel={(id) => {
              onChange({ provider, modelId: id });
            }}
            onSelectReasoning={(effort) => {
              if (!model) return;
              onChange({ provider, modelId: model.id, reasoningEffort: effort });
            }}
            disabled={false}
            reasoningLocked={false}
          />
        </div>
      </Popover>
    </>
  );
}
