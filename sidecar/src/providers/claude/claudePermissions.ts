// How DROIDEX's autonomy levels and approval cards meet Claude Code's
// permission callback. Nothing here may resolve to null or undefined: the SDK
// treats that as "the host answered out of band" and parks the tool call for
// the worker's whole deadline.
import type { CanUseTool, PermissionMode, PermissionResult } from '@anthropic-ai/claude-agent-sdk';

import type { Autonomy, PermissionKind } from '../../protocol.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';

// 'off' denies anything not already granted without prompting, which is the
// honest reading of "do nothing on your own"; 'low' and 'medium' prompt through
// canUseTool; 'high' runs unattended.
export function claudePermissionMode(autonomy: Autonomy): PermissionMode {
  if (autonomy === 'off') return 'dontAsk';
  if (autonomy === 'high') return 'bypassPermissions';
  return 'default';
}

const TOOL_KINDS: Record<string, PermissionKind> = {
  Bash: 'exec',
  Edit: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Write: 'create',
};

export function claudeCanUseTool(
  appSessionId: string,
  interactions: ProviderInteractions,
): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    if (toolName === 'AskUserQuestion') return await askUserQuestion(input, interactions);
    // Plan approval is its own flow; auto-allowing it would let the model act on
    // a plan the user has not seen.
    if (toolName === 'ExitPlanMode')
      return deny('Stop here and wait for the user to review the plan.');

    const kind = permissionKind(toolName);
    const signature = permissionSignature(toolName, kind, input);
    const outcome = await Promise.race([
      interactions.requestApproval({
        request: {
          appSessionId,
          requestId: nextInteractionRequestId(),
          kind,
          title: options.displayName ?? toolName,
          detail: options.title ?? options.description ?? describeInput(input),
          raw: { toolName, input },
        },
        confirmationType: CONFIRMATION_TYPES[kind],
        ...(signature ? { signature } : {}),
      }),
      // The turn was interrupted while the card was still open: the tool must
      // settle, and the pending card is cleared with the session's turn.
      abortedOutcome(options.signal),
    ]);
    if (outcome === 'cancel')
      return { behavior: 'deny', message: 'The user stopped this tool.', interrupt: true };
    if (!outcome.startsWith('proceed')) return deny('The user declined this tool.');
    return {
      behavior: 'allow',
      ...(outcome === 'proceed_always' && options.suggestions
        ? { updatedPermissions: options.suggestions }
        : {}),
    };
  };
}

// The questions dialog belongs to the CLI's own UI, and `updatedInput` may only
// relabel the questions, never answer them. Asking in DROIDEX and handing the
// answers back as the tool's result is the only way the model hears them.
async function askUserQuestion(
  input: Record<string, unknown>,
  interactions: ProviderInteractions,
): Promise<PermissionResult> {
  const asked = askedQuestions(input);
  if (asked.length === 0) return deny('No question was asked.');
  const { cancelled, answers } = await interactions.requestQuestion(asked);
  if (cancelled) return deny('The user dismissed the question.');
  return deny(answers.map((a) => `${a.question}\n${a.answer}`).join('\n\n'));
}

interface AskedQuestion {
  question?: unknown;
  options?: { label?: unknown }[];
}

function askedQuestions(
  input: Record<string, unknown>,
): { index: number; question: string; options: string[] }[] {
  const questions = Array.isArray(input.questions) ? (input.questions as AskedQuestion[]) : [];
  return questions.flatMap((asked, index) =>
    typeof asked.question === 'string'
      ? [
          {
            index,
            question: asked.question,
            options: (asked.options ?? []).flatMap((option) =>
              typeof option.label === 'string' ? [option.label] : [],
            ),
          },
        ]
      : [],
  );
}

const CONFIRMATION_TYPES: Record<PermissionKind, string> = {
  edit: 'edit',
  exec: 'exec',
  create: 'create',
  apply_patch: 'apply_patch',
  mcp: 'mcp_tool',
  spec: 'exit_spec_mode',
  mission_plan: 'propose_mission',
  other: 'other',
};

function permissionKind(toolName: string): PermissionKind {
  return TOOL_KINDS[toolName] ?? (toolName.startsWith('mcp__') ? 'mcp' : 'other');
}

// The key an "always allow" grant is stored under. Scoped the way Droid scopes
// its own (normalize.ts): a command or a file path, never a bare tool name, so
// one grant cannot silently cover an unrelated action. An empty result leaves
// the request ineligible for always-allow.
function permissionSignature(
  toolName: string,
  kind: PermissionKind,
  input: Record<string, unknown>,
): string | undefined {
  if (kind === 'mcp') return `mcp::${toolName}`;
  if (kind === 'exec') return text(input.command) && `exec::${String(input.command)}`;
  if (kind !== 'edit' && kind !== 'create') return undefined;
  const path = text(input.file_path) ?? text(input.notebook_path);
  return path ? `${kind}::${path}` : undefined;
}

function describeInput(input: Record<string, unknown>): string {
  return Object.entries(input)
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function deny(message: string): PermissionResult {
  return { behavior: 'deny', message };
}

function abortedOutcome(signal: AbortSignal): Promise<'cancel'> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve('cancel');
      return;
    }
    signal.addEventListener('abort', () => {
      resolve('cancel');
    });
  });
}
