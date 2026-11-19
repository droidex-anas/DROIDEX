import type {
  Autonomy,
  ReasoningEffort,
  Automation,
  AutomationSchedule,
  AutomationTarget,
} from '@droidex/protocol';

export interface AutomationDraft {
  title: string;
  prompt: string;
  target: AutomationTarget;
  files: string[];
  workspaceCwd: string | null;
  executionMode: 'worktree' | 'local';
  enabled: boolean;
  schedule: AutomationSchedule;
  timezone: string;
  modelId: string | null;
  reasoningEffort: ReasoningEffort | null;
  autonomy: Autonomy;
}

export type AutomationEditorState =
  | { mode: 'create'; draft: AutomationDraft }
  | { mode: 'edit'; automation: Automation; draft: AutomationDraft };
