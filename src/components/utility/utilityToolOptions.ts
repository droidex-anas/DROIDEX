import {
  ChangesIcon,
  Files,
  Globe,
  Hierarchy,
  MessageSquareText,
  SquareTerminal,
  type IconComponent,
} from '@droidex/icons';
import type { UtilityTool } from '../../lib/utilityPanel';

export interface UtilityToolOption {
  tool: UtilityTool;
  label: string;
  icon: IconComponent;
  shortcut: string;
}

export const UTILITY_TOOL_OPTIONS: UtilityToolOption[] = [
  { tool: 'review', label: 'Review', icon: ChangesIcon, shortcut: '⌘⇧R' },
  { tool: 'terminal', label: 'Terminal', icon: SquareTerminal, shortcut: '⌃`' },
  { tool: 'browser', label: 'Browser', icon: Globe, shortcut: '⌘⇧B' },
  { tool: 'files', label: 'Files', icon: Files, shortcut: '⌘⇧F' },
  { tool: 'threads', label: 'Threads', icon: MessageSquareText, shortcut: '' },
];

// Opened from an agent row, never from the picker: the tool grid stays the four
// tools a session always has.
const AGENTS_TOOL_OPTION: UtilityToolOption = {
  tool: 'agents',
  label: 'Subagents',
  icon: Hierarchy,
  shortcut: '',
};

export function utilityToolOption(tool: UtilityTool): UtilityToolOption {
  if (tool === 'agents') return AGENTS_TOOL_OPTION;
  return UTILITY_TOOL_OPTIONS.find((option) => option.tool === tool) ?? UTILITY_TOOL_OPTIONS[0];
}
