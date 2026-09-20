import { useRef, useState } from 'react';
import { ChevronDown } from '@droidex/icons';
import ModelCatalogList from '../../components/ModelCatalogList';
import { Popover } from '../../components/environment/Popover';
import { ModelIcon, providerOf } from '../../components/ModelIcon';
import AutonomySelector from '../../components/AutonomySelector';
import { reasoningEffortLabel } from '../../lib/reasoningEffort';
import ProviderPicker from '../providers/ProviderPicker';
import type { ThreadCatalog, ThreadSelection } from './useThreadSelection';

/* What a project's lead will run with. The model control is the app's own
   catalog list in the app's own popover — the same rows, search and effort
   levels the composer offers — because a second, native picker would neither
   match the app nor show a harness's real catalog. */

export function ThreadSettings({
  value,
  catalog,
  disabled,
  onChange,
}: {
  value: ThreadSelection;
  catalog: ThreadCatalog;
  disabled: boolean;
  onChange: (selection: ThreadSelection) => void;
}) {
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const modelRef = useRef<HTMLButtonElement>(null);
  const selected = catalog.models.find((model) => model.id === value.modelId);
  const shown = selected ?? catalog.defaultModel;
  const effort = value.reasoning ?? shown?.defaultReasoningEffort;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <ProviderPicker
        value={value.provider}
        locked={disabled}
        open={providerOpen}
        onOpenChange={setProviderOpen}
        onSelect={(provider) => {
          onChange({ ...value, provider, modelId: '', reasoning: undefined });
        }}
      />
      <button
        ref={modelRef}
        type="button"
        disabled={disabled}
        aria-expanded={modelOpen}
        onClick={() => {
          setModelOpen((open) => !open);
        }}
        className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-elevated disabled:opacity-40"
      >
        <ModelIcon provider={providerOf(shown, value.modelId)} size={14} />
        <span className="max-w-[150px] truncate">{shown?.displayName ?? 'Default model'}</span>
        {effort && (
          <span className="shrink-0 text-droid-text-muted">
            {reasoningEffortLabel(effort, value.provider)}
          </span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-droid-text-muted" />
      </button>
      <Popover
        open={modelOpen}
        onClose={() => {
          setModelOpen(false);
        }}
        anchorRef={modelRef}
        align="left"
        width={320}
        label="Choose a model"
      >
        <ModelCatalogList
          models={catalog.models}
          defaultModel={catalog.defaultModel}
          hasRealModels={catalog.models.length > 0}
          provider={value.provider}
          selectedModelId={value.modelId || undefined}
          reasoning={value.reasoning}
          query=""
          disabled={disabled}
          reasoningLocked={false}
          showReasoning={catalog.efforts.length > 0}
          onSelectModel={(modelId) => {
            onChange({ ...value, modelId: modelId ?? '', reasoning: undefined });
            setModelOpen(false);
          }}
          onSelectReasoning={(reasoning) => {
            onChange({ ...value, reasoning });
          }}
        />
      </Popover>
      <AutonomySelector
        scope="draft"
        value={value.autonomy}
        disabled={disabled}
        onSelect={(autonomy) => {
          onChange({ ...value, autonomy });
        }}
        placement="down"
      />
    </div>
  );
}
