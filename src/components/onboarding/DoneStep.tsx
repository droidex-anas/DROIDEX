import { ArrowRight, FileText } from '@droidex/icons';
import { PROVIDER_LABELS } from '../../features/providers/providerIdentity';
import { editorLabel, type EditorId } from '../../lib/editorOpen';
import type { ProviderKind } from '../../types/bridge';
import { ActivityStatusGlyph } from '../ActivityStatusGlyph';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { AgentTile } from './AgentTile';
import { canStartChats, joinNames, type AgentStatus, type AgentStatuses } from './agents';

function stateLabel(status: AgentStatus): string {
  switch (status.state) {
    case 'checking':
      return 'Checking';
    case 'missing':
      return 'Not installed';
    case 'unavailable':
      return 'Unavailable';
    case 'signin':
      return status.canRun ? (status.install.version ?? 'Installed') : 'Needs sign-in';
    case 'ready':
      return status.install.version ?? 'Ready';
  }
}

export function DoneStep({
  chosen,
  statuses,
  editor,
  draftAgent,
  finishing,
  onStart,
  onBack,
}: {
  chosen: readonly ProviderKind[];
  statuses: AgentStatuses;
  editor: EditorId;
  draftAgent: ProviderKind;
  finishing: boolean;
  onStart: () => void;
  onBack: () => void;
}) {
  const unready = chosen.filter((agent) => !canStartChats(statuses[agent]));
  const title = unready.length === 0 ? "You're all set" : 'Almost there';
  const sub =
    unready.length === 0
      ? `${joinNames(chosen)} ${chosen.length === 1 ? 'is' : 'are'} ready. Start a chat and give one of them something to do.`
      : `${joinNames(unready)} ${unready.length === 1 ? 'still needs' : 'still need'} setting up. Finish any time from Settings.`;

  return (
    <div className="flex h-full flex-col justify-center pb-20">
      <h1 className="droid-rise text-hero text-primary">{title}</h1>
      <p
        className="droid-rise mt-4 max-w-md text-body-lg text-secondary"
        style={{ animationDelay: '60ms' }}
      >
        {sub}
      </p>
      <div
        className="droid-rise ob-well mt-8 flex w-full max-w-md flex-col p-1"
        style={{ animationDelay: '120ms' }}
      >
        {chosen.map((agent) => {
          const status = statuses[agent];
          const runnable = canStartChats(status);
          return (
            <div key={agent} className="flex h-11 items-center gap-3 px-2.5">
              <AgentTile agent={agent} small />
              <span className="text-body text-primary">{PROVIDER_LABELS[agent]}</span>
              {agent === draftAgent && runnable && <Badge>New chats</Badge>}
              <span className="flex-1" />
              <span className="text-caption tabular-nums text-muted">{stateLabel(status)}</span>
              <ActivityStatusGlyph status={runnable ? 'settled' : 'approval'} decorative />
            </div>
          );
        })}
        <div className="flex h-11 items-center gap-3 px-2.5">
          <span className="ob-tile ob-tile-sm text-secondary" aria-hidden="true">
            <FileText className="size-icon-sm" />
          </span>
          <span className="text-body text-primary">Files open in {editorLabel(editor)}</span>
        </div>
      </div>
      <div className="droid-rise mt-8 flex items-center gap-2" style={{ animationDelay: '180ms' }}>
        <Button
          variant="primary"
          size="lg"
          data-primary
          loading={finishing}
          disabled={finishing}
          onClick={onStart}
        >
          <span className="flex items-center gap-1.5">
            Start building
            <ArrowRight className="size-icon-md" aria-hidden="true" />
          </span>
        </Button>
        <Button variant="ghost" size="lg" data-back disabled={finishing} onClick={onBack}>
          Back
        </Button>
      </div>
    </div>
  );
}
