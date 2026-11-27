import { useState } from 'react';
import { ArrowLeft, CheckCircle2, FileDiff } from 'lucide-react';
import { Spinner } from '@droidex/icons';
import type { BridgeFeature, TranscriptEvent } from '@droidex/protocol';
import { extractFileChange, type FileChange } from '../lib/diff';
import { displayPath } from '../lib/pathDisplay';
import { CAT_LABEL, toolMeta } from '../lib/tools';

const ACCENT = 'var(--accent)';
const accentMix = (pct: number) => `color-mix(in srgb, var(--accent) ${String(pct)}%, transparent)`;

function StatusDot({ status }: { status: string }) {
  if (status === 'completed')
    return <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: ACCENT }} />;
  if (status === 'in_progress')
    return (
      <Spinner
        className="w-4 h-4 mt-0.5 shrink-0 motion-safe:animate-spin-slow"
        style={{ color: ACCENT }}
      />
    );
  return <span className="mt-1.5 w-2.5 h-2.5 rounded-full border border-divider shrink-0" />;
}

function ActionRow({
  event,
  cwd,
  onOpenDiff,
}: {
  event: TranscriptEvent;
  cwd?: string;
  onOpenDiff?: (c: FileChange) => void;
}) {
  const { cat, detail } = toolMeta(event.toolName, event.toolArgs);
  const change = extractFileChange(event.toolName, event.toolArgs);
  const clickable = !!change && !!onOpenDiff;
  const displayDetail =
    change || cat === 'read' ? displayPath(change?.path ?? detail, cwd) : detail;
  return (
    <button
      disabled={!clickable}
      onClick={() => change && onOpenDiff?.(change)}
      className={`w-full flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-left ${clickable ? 'hover:bg-elevated/60 cursor-pointer' : 'cursor-default'}`}
      title={detail || undefined}
    >
      <span className="text-label text-secondary shrink-0">{CAT_LABEL[cat]}</span>
      <span className="text-caption text-muted truncate">{displayDetail || event.toolName}</span>
      {clickable && <FileDiff className="w-3 h-3 ml-auto shrink-0 text-muted/60" />}
    </button>
  );
}

function SpecList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted mb-1.5">
        {title}
      </div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="flex gap-2 text-[13px] text-secondary leading-relaxed">
            <span className="mt-[7px] w-1 h-1 rounded-full bg-muted shrink-0" />
            <span className="break-words">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function FeatureFocus({
  feature,
  events,
  cwd,
  onBack,
  onOpenDiff,
}: {
  feature: BridgeFeature;
  events: TranscriptEvent[];
  cwd?: string;
  onBack: () => void;
  onOpenDiff?: (c: FileChange) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const toolCalls = events.filter(
    (event) =>
      event.kind === 'tool_call' && (event.role === 'worker' || event.role === 'validator'),
  );
  const curated = toolCalls.filter((e) => toolMeta(e.toolName, e.toolArgs).cat !== 'other');
  const shown = showAll ? toolCalls : curated;
  const noSpec =
    feature.preconditions.length === 0 &&
    feature.expectedBehavior.length === 0 &&
    feature.verificationSteps.length === 0;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-6">
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-[12px] text-muted hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to chat
        </button>

        <div className="flex items-start gap-3 mb-5">
          <StatusDot status={feature.status} />
          <div className="min-w-0">
            <h2 className="text-[16px] font-semibold text-primary leading-snug break-words">
              {feature.description}
            </h2>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {feature.skillName && (
                <span
                  className="px-1.5 py-0.5 rounded-xs text-[11px] font-medium"
                  style={{ color: ACCENT, background: accentMix(10) }}
                >
                  [{feature.skillName}]
                </span>
              )}
              {feature.milestone && (
                <span className="text-[11px] text-muted">{feature.milestone}</span>
              )}
              <span className="text-[11px] text-muted capitalize">
                {feature.status.replace(/_/g, ' ')}
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-lg bg-elevated/25 p-4 mb-6">
          {noSpec ? (
            <div className="text-[13px] text-muted">No spec details provided for this feature.</div>
          ) : (
            <>
              <SpecList title="Preconditions" items={feature.preconditions} />
              <SpecList title="Expected behavior" items={feature.expectedBehavior} />
              <SpecList title="Verification" items={feature.verificationSteps} />
            </>
          )}
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium uppercase tracking-wider text-secondary">
              Worker actions
            </span>
            <span className="tabular-nums text-[11px] text-muted">{shown.length}</span>
          </div>
          {toolCalls.length > curated.length && (
            <button
              onClick={() => {
                setShowAll((v) => !v);
              }}
              className="text-[11px] text-muted hover:text-primary transition-colors"
            >
              {showAll ? 'Show key actions' : `Reveal all (${String(toolCalls.length)})`}
            </button>
          )}
        </div>
        <div className="space-y-1">
          {shown.map((e) => (
            <ActionRow key={e.id} event={e} cwd={cwd} onOpenDiff={onOpenDiff} />
          ))}
          {shown.length === 0 && (
            <div className="py-8 text-center text-[13px] text-muted">
              No worker activity recorded yet.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
