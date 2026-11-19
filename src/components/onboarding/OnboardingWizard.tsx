import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { ArrowRight } from '@droidex/icons';
import type { OnboardingController } from '../../hooks/useOnboarding';
import { useStoreDispatch, useStoreSelector } from '../../hooks/useStore';
import { listEditors } from '../../lib/desktop';
import {
  getDefaultEditor,
  normalizeEditorId,
  setDefaultEditor,
  type EditorId,
} from '../../lib/editorOpen';
import type { OnboardingState } from '../../lib/onboarding';
import { toast } from '../../lib/toast';
import type { ProviderKind } from '../../types/bridge';
import { Button } from '../ui/Button';
import { cn } from '../ui/cn';
import { AgentsStep } from './AgentsStep';
import {
  AGENTS,
  canStartChats,
  chosenAgents,
  needsSetup,
  nextToSetUp,
  startingAgent,
  type AgentPicks,
} from './agents';
import { DefaultsStep, type Defaults } from './DefaultsStep';
import { DoneStep } from './DoneStep';
import { PixelStage } from './PixelStage';
import { SetupStep } from './SetupStep';
import { agentProgress, stageFigures, type FlowStep } from './stage';
import { StepProgress, type SetupStepId } from './StepProgress';
import { recheckAgents, useAgentSetup } from './useAgentSetup';
import { Welcome } from './Welcome';
import './onboarding.css';

const ORDER: readonly FlowStep[] = ['welcome', 'agents', 'setup', 'defaults', 'done'];
const NEXT: Record<SetupStepId, FlowStep> = {
  agents: 'setup',
  setup: 'defaults',
  defaults: 'done',
};
const BACK: Record<SetupStepId, FlowStep> = {
  agents: 'welcome',
  setup: 'agents',
  defaults: 'setup',
};

function isSetupStep(step: FlowStep): step is SetupStepId {
  return step === 'agents' || step === 'setup' || step === 'defaults';
}

function initialDefaults(onboarding: OnboardingState | null, draftAgent: ProviderKind): Defaults {
  return {
    editor:
      onboarding?.defaultEditor === undefined
        ? getDefaultEditor()
        : normalizeEditorId(onboarding.defaultEditor),
    draftAgent,
    cliAutoUpdate: onboarding?.cliAutoUpdate ?? true,
    harnessCliAutoUpdate: onboarding?.harnessCliAutoUpdate ?? true,
    appAutoUpdate: onboarding?.appAutoUpdate ?? true,
  };
}

// Return presses the one primary action on screen and Escape goes back a
// step, unless focus is on a control that owns the key.
function useStepKeys(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented) return;
      const owner = event.target instanceof Element ? event.target : null;
      let selector: string;
      if (event.key === 'Enter') {
        if (owner?.closest('input, textarea, button, a, [role="menu"]')) return;
        selector = '[data-primary]';
      } else if (event.key === 'Escape') {
        if (owner?.closest('input, textarea, [role="menu"]')) return;
        selector = '[data-back]';
      } else {
        return;
      }
      const candidates = Array.from(
        root.current?.querySelectorAll<HTMLButtonElement>(selector) ?? [],
      );
      const target = candidates.find((button) => !button.disabled && !button.closest('[inert]'));
      if (!target) return;
      event.preventDefault();
      target.click();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [root]);
}

// The first-run flow: pick agents, install and sign in to them, set a few
// defaults. Nothing is saved until it finishes or is put off for later.
export default function OnboardingWizard({
  controller,
  onComplete,
}: {
  controller: OnboardingController;
  onComplete: () => void;
}) {
  const { statuses, runs, install, clearRun } = useAgentSetup(controller);
  const draftProvider = useStoreSelector((state) => state.draftProvider);
  const dispatch = useStoreDispatch();
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<FlowStep>('welcome');
  // 1 moving forward, -1 going back: the side the next step slides in from.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [picks, setPicks] = useState<AgentPicks>({});
  const [scanned, setScanned] = useState(false);
  const [spotlight, setSpotlight] = useState<ProviderKind>('droid');
  const [skipped, setSkipped] = useState<ProviderKind[]>([]);
  const [open, setOpen] = useState<ProviderKind | null>(null);
  const [defaults, setDefaults] = useState(() =>
    initialDefaults(controller.onboarding, draftProvider),
  );
  const [installedEditors, setInstalledEditors] = useState<EditorId[]>([]);
  const [saving, setSaving] = useState(false);
  const [seenStatuses, setSeenStatuses] = useState(statuses);

  const chosen = useMemo(() => chosenAgents(picks, statuses), [picks, statuses]);
  // Derived, not stored: the preferred agent may not be able to start chats
  // yet, and an agent that turns ready later has to be able to take over.
  const draftAgent = startingAgent(chosen, statuses, defaults.draftAgent);
  const installing = AGENTS.find((agent) => runs[agent]?.outcome === 'running') ?? null;

  // When the open agent turns ready, setup moves on to the next one that
  // still needs a hand.
  if (seenStatuses !== statuses) {
    setSeenStatuses(statuses);
    const becameReady =
      open !== null && seenStatuses[open].state !== 'ready' && statuses[open].state === 'ready';
    if (step === 'setup' && becameReady) setOpen(nextToSetUp(chosen, statuses, open, skipped));
  }

  useEffect(() => {
    let cancelled = false;
    void listEditors().then((ids) => {
      if (cancelled) return;
      setInstalledEditors(ids);
      const first = ids.at(0);
      setDefaults((current) =>
        first === undefined || ids.includes(current.editor)
          ? current
          : { ...current, editor: first },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useStepKeys(root);

  const markScanned = useCallback(() => {
    setScanned(true);
  }, []);

  function go(next: FlowStep) {
    setDirection(ORDER.indexOf(next) >= ORDER.indexOf(step) ? 1 : -1);
    setStep(next);
    if (next === 'agents' && !scanned) recheckAgents();
    if (next === 'setup') setOpen(nextToSetUp(chosen, statuses, null, skipped));
  }

  function skipAgent(agent: ProviderKind) {
    const nextSkipped = skipped.includes(agent) ? skipped : [...skipped, agent];
    setSkipped(nextSkipped);
    setOpen(nextToSetUp(chosen, statuses, agent, nextSkipped));
  }

  async function complete(patch: Partial<OnboardingState>): Promise<boolean> {
    setSaving(true);
    try {
      await controller.patch({ ...patch, completed: true });
      return true;
    } catch {
      toast.error("Couldn't finish setup. Try again.");
      setSaving(false);
      return false;
    }
  }

  async function putOff() {
    if (await complete({})) onComplete();
  }

  async function finish() {
    const { editor, cliAutoUpdate, harnessCliAutoUpdate, appAutoUpdate } = defaults;
    const saved = await complete({
      defaultEditor: editor,
      cliAutoUpdate,
      harnessCliAutoUpdate,
      appAutoUpdate,
    });
    if (!saved) return;
    setDefaultEditor(editor);
    if (chosen.includes(draftAgent) && canStartChats(statuses[draftAgent])) {
      dispatch({ type: 'SET_DRAFT_PROVIDER', provider: draftAgent });
    }
    onComplete();
  }

  let lead: ProviderKind | null = null;
  if (step === 'agents') lead = spotlight;
  else if (step === 'setup') lead = installing ?? open;
  else if (step === 'defaults') lead = draftAgent;
  const figures = stageFigures({
    step,
    chosen,
    lead,
    progress: {
      droid: agentProgress(statuses.droid, runs.droid),
      claude: agentProgress(statuses.claude, runs.claude),
      codex: agentProgress(statuses.codex, runs.codex),
    },
  });

  let body: ReactNode;
  let canContinue = true;
  // While an open agent still needs something, its own action is the
  // primary one on screen.
  let continueIsPrimary = true;
  switch (step) {
    case 'welcome':
      body = (
        <Welcome
          finishing={saving}
          onStart={() => {
            go('agents');
          }}
          onSkip={() => void putOff()}
        />
      );
      break;
    case 'agents':
      canContinue = scanned && chosen.length > 0;
      body = (
        <AgentsStep
          chosen={chosen}
          statuses={statuses}
          scanned={scanned}
          onToggle={(agent) => {
            setPicks((current) => ({ ...current, [agent]: !chosen.includes(agent) }));
            setSpotlight(agent);
          }}
          onSpotlight={setSpotlight}
          onScanned={markScanned}
          onRescan={() => {
            setScanned(false);
            recheckAgents();
          }}
        />
      );
      break;
    case 'setup':
      canContinue = installing === null;
      continueIsPrimary = open === null || !needsSetup(statuses[open]);
      body = (
        <SetupStep
          chosen={chosen}
          statuses={statuses}
          runs={runs}
          installing={installing}
          skipped={skipped}
          open={open}
          availableChannels={controller.env?.availableChannels ?? []}
          onOpen={(agent) => {
            setOpen((current) => (current === agent ? null : agent));
          }}
          onInstall={install}
          onClearRun={clearRun}
          onSkip={skipAgent}
          saveApiKey={controller.saveApiKey}
        />
      );
      break;
    case 'defaults':
      body = (
        <DefaultsStep
          values={{ ...defaults, draftAgent }}
          chosen={chosen}
          statuses={statuses}
          installedEditors={installedEditors}
          onChange={(patch) => {
            setDefaults((current) => ({ ...current, ...patch }));
          }}
        />
      );
      break;
    case 'done':
      body = (
        <DoneStep
          chosen={chosen}
          statuses={statuses}
          editor={defaults.editor}
          draftAgent={draftAgent}
          finishing={saving}
          onStart={() => void finish()}
          onBack={() => {
            go('defaults');
          }}
        />
      );
      break;
  }

  return (
    <div ref={root} className="ob-root relative min-h-0 flex-1 overflow-hidden">
      <div className="ob-stage">
        <PixelStage figures={figures} />
      </div>
      <header
        data-electron-drag-region
        className="absolute inset-x-0 top-0 z-10 flex h-9 items-center justify-end pr-3"
      >
        {isSetupStep(step) && (
          <Button variant="ghost" size="sm" disabled={saving} onClick={() => void putOff()}>
            Set up later
          </Button>
        )}
      </header>
      <div className="ob-column">
        {isSetupStep(step) && (
          <div className="shrink-0 pt-10">
            <StepProgress current={step} onGo={go} />
          </div>
        )}
        <div
          key={step}
          className={cn('ob-step ob-scroll min-h-0 flex-1', isSetupStep(step) && 'pt-9')}
          style={{ '--ob-direction': direction } as CSSProperties}
        >
          {body}
        </div>
        {isSetupStep(step) && (
          <div className="flex shrink-0 items-center gap-2 pb-12 pt-4">
            <Button
              variant={continueIsPrimary ? 'primary' : 'secondary'}
              size="lg"
              data-primary={continueIsPrimary || undefined}
              disabled={!canContinue}
              onClick={() => {
                go(NEXT[step]);
              }}
            >
              <span className="flex items-center gap-1.5">
                {step === 'defaults' ? 'Finish' : 'Continue'}
                <ArrowRight className="size-icon-md" aria-hidden="true" />
              </span>
            </Button>
            <Button
              variant="ghost"
              size="lg"
              data-back
              onClick={() => {
                go(BACK[step]);
              }}
            >
              Back
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
