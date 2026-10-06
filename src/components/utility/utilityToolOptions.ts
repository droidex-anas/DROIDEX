import {
  ChangesIcon,
  Files,
  Globe,
  Hierarchy,
  LayoutTemplate,
  MessageBubble,
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
];

// Opened from an agent row or a project thread, never from the picker: the tool
// grid stays the four tools a session always has. Threads belong to Projects,
// so an ordinary chat is never offered one.
const AGENTS_TOOL_OPTION: UtilityToolOption = {
  tool: 'agents',
  label: 'Subagents',
  icon: Hierarchy,
  shortcut: '',
};

const THREADS_TOOL_OPTION: UtilityToolOption = {
  tool: 'threads',
  label: 'Threads',
  icon: MessageSquareText,
  shortcut: '',
};

// Opened by an artifact card's Open or the design entry point, never from the
// picker: Canvas belongs to a chat that has designs, not to every chat.
const CANVAS_TOOL_OPTION: UtilityToolOption = {
  tool: 'canvas',
  label: 'Canvas',
  icon: LayoutTemplate,
  shortcut: '',
};

// Opened by `/side`, `/btw`, or a chat's own side-chat action.
const SIDE_TOOL_OPTION: UtilityToolOption = {
  tool: 'side',
  label: 'Side chat',
  icon: MessageBubble,
  shortcut: '',
};

export function utilityToolOption(tool: UtilityTool): UtilityToolOption {
  if (tool === 'agents') return AGENTS_TOOL_OPTION;
  if (tool === 'threads') return THREADS_TOOL_OPTION;
  if (tool === 'side') return SIDE_TOOL_OPTION;
  if (tool === 'canvas') return CANVAS_TOOL_OPTION;
  return UTILITY_TOOL_OPTIONS.find((option) => option.tool === tool) ?? UTILITY_TOOL_OPTIONS[0];
}
