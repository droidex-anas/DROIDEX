import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ModelInfo, SessionSummary } from '../../types/bridge';
import { AutomationRow } from './AutomationRow';
import { automationModelSelectionIssue } from './modelSelection';
import type { Automation, AutomationRun } from './types';

export function AutomationList({
  automations,
  latestRuns,
  models,
  sessions,
  now,
  pendingDeleteId,
  onEdit,
  onToggle,
  onRun,
  onDelete,
  onOpenSession,
}: {
  automations: Automation[];
  latestRuns: Map<string, AutomationRun>;
  models: ModelInfo[];
  sessions: Partial<Record<string, SessionSummary>>;
  now: number;
  pendingDeleteId: string | null;
  onEdit: (automation: Automation) => void;
  onToggle: (automation: Automation, enabled: boolean) => void;
  onRun: (automation: Automation) => void;
  onDelete: (automation: Automation) => void;
  onOpenSession: (appSessionId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const modelsById = useMemo(() => new Map(models.map((model) => [model.id, model])), [models]);
  const virtualizer = useVirtualizer({
    count: automations.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => {
      const automation = automations.at(index);
      if (!automation) throw new Error('Automation row index is out of bounds.');
      return automation.id;
    },
    estimateSize: () => 108,
    overscan: 3,
  });

  return (
    <div
      ref={scrollRef}
      role="list"
      aria-label="Automations"
      tabIndex={0}
      className="mt-4 max-h-[60vh] overflow-y-auto rounded-2xl border border-droid-border/80 bg-droid-surface/20 outline-none [container-type:inline-size] focus-visible:border-droid-border-hover"
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const automation = automations.at(item.index);
          if (!automation) return null;
          const model = modelsById.get(automation.modelId ?? '');
          const target = automation.target;
          return (
            <div
              key={item.key}
              ref={virtualizer.measureElement}
              data-index={item.index}
              role="listitem"
              aria-posinset={item.index + 1}
              aria-setsize={automations.length}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${String(item.start)}px)` }}
            >
              <AutomationRow
                automation={automation}
                run={latestRuns.get(automation.id)}
                model={model}
                modelIssue={
                  target.kind === 'existing-session'
                    ? null
                    : automationModelSelectionIssue(
                        model ? [model] : [],
                        automation.modelId,
                        automation.reasoningEffort,
                      )
                }
                targetTitle={
                  target.kind === 'existing-session'
                    ? sessions[target.appSessionId]?.title
                    : undefined
                }
                now={now}
                deleteArmed={pendingDeleteId === automation.id}
                last={item.index === automations.length - 1}
                onEdit={() => {
                  onEdit(automation);
                }}
                onToggle={(enabled) => {
                  onToggle(automation, enabled);
                }}
                onRun={() => {
                  onRun(automation);
                }}
                onDelete={() => {
                  onDelete(automation);
                }}
                onOpenSession={onOpenSession}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
