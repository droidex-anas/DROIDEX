import type { ProviderKind, SkillInfo } from '@droidex/protocol';
import type { AutomationDraft } from '../../features/automations/types';
import {
  composePrompt,
  promptTextWithVisualize,
  runsAsCompactCommand,
} from '../../lib/composePrompt';
import { feedbackDraftFromCommand } from '../../lib/feedbackReport';
import { sideChatPromptFromCommand } from '../../lib/sideChats';
import type { SlashCommand } from '../ComposerMenu';
import { mentionsForRows } from './composerCatalog';
import { USAGE_COMMAND } from './submitComposerPrompt';

export interface ScheduledPromptDraft {
  input: string;
  visualizeSelected: boolean;
  activeSkills: SkillInfo[];
  provider: ProviderKind;
  findFastCommand: (text: string) => SlashCommand | undefined;
}

export function buildScheduledPromptDraft({
  draft,
  paths,
  appSessionId,
  runAt,
  timezone,
  defaults,
}: {
  draft: ScheduledPromptDraft;
  paths: string[];
  appSessionId: string;
  runAt: number;
  timezone: string;
  defaults: AutomationDraft;
}): AutomationDraft {
  const { input, visualizeSelected, activeSkills, provider, findFastCommand } = draft;
  const text = promptTextWithVisualize(input.trim(), visualizeSelected);
  const skills = activeSkills.map((skill) => skill.name);
  if (!text && skills.length === 0 && paths.length === 0) {
    throw new Error('Write a prompt or add an attachment first.');
  }
  if (mentionsForRows(provider, activeSkills).length > 0) {
    throw new Error(
      'Apps and plugins cannot be scheduled yet. Remove them, or send this prompt now.',
    );
  }
  if (
    input.trim() === USAGE_COMMAND ||
    findFastCommand(input.trim()) !== undefined ||
    runsAsCompactCommand(text, {
      visualizeSelected,
      skillCount: skills.length,
      fileCount: paths.length,
    }) ||
    feedbackDraftFromCommand(text) ||
    sideChatPromptFromCommand(text) !== null
  ) {
    throw new Error('App commands cannot be scheduled. Write a prompt for the agent instead.');
  }
  return {
    ...defaults,
    title: (input.trim() || skills[0] || 'Scheduled prompt').replace(/\s+/g, ' ').slice(0, 80),
    prompt: composePrompt(text, skills, []),
    files: paths,
    target: { kind: 'existing-session', appSessionId },
    schedule: { kind: 'once', runAt },
    timezone,
  };
}
