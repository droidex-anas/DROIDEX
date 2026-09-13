// How DROIDEX's autonomy levels and approval cards meet Claude Code's
// permission callback. Nothing here may resolve to null or undefined: the SDK
// treats that as "the host answered out of band" and parks the tool call for
// the worker's whole deadline.
import type { CanUseTool, PermissionMode, PermissionResult } from '@anthropic-ai/claude-agent-sdk';

import {
  AUTOMATION_MCP_SERVER_NAME,
  isAutomationMutationTool,
  normalizeMcpServerName,
} from '../../automations/permissionPolicy.js';
import { toolArgumentDigest } from '../../normalize.js';
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

const INTERRUPTED = Symbol('interrupted');

type CanUseToolOptions = Parameters<CanUseTool>[2];

export function claudeCanUseTool(
  appSessionId: string,
  interactions: ProviderInteractions,
): CanUseTool {
  return async (toolName, input, options): Promise<PermissionResult> => {
    // Plan approval is its own flow; auto-allowing it would let the model act on
    // a plan the user has not seen.
    if (toolName === 'ExitPlanMode')
      return deny('Stop here and wait for the user to review the plan.');
    const decision = await Promise.race([
      toolName === 'AskUserQuestion'
        ? askUserQuestion(input, interactions)
        : approveTool(appSessionId, toolName, input, options, interactions),
      interrupted(options.signal),
    ]);
    if (decision !== INTERRUPTED) return decision;
    // The turn ended with the card still open. Settling only the SDK's side
    // would leave the prompt and its waiter behind, under the next turn.
    interactions.cancelPending();
    return {
      behavior: 'deny',
      message: 'The turn was stopped before this was answered.',
      interrupt: true,
    };
  };
}

async function approveTool(
  appSessionId: string,
  toolName: string,
  input: Record<string, unknown>,
  options: CanUseToolOptions,
  interactions: ProviderInteractions,
): Promise<PermissionResult> {
  const kind = permissionKind(toolName);
  const mcp = kind === 'mcp' ? mcpTarget(toolName) : undefined;
  const signature = permissionSignature(kind, mcp, input);
  const outcome = await interactions.requestApproval({
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
    ...(mcp && normalizeMcpServerName(mcp.serverName) === AUTOMATION_MCP_SERVER_NAME
      ? { automationTool: mcp }
      : {}),
  });
  if (outcome === 'cancel')
    return { behavior: 'deny', message: 'The user stopped this tool.', interrupt: true };
  if (!outcome.startsWith('proceed')) return deny('The user declined this tool.');
  return {
    behavior: 'allow',
    ...(outcome === 'proceed_always' && options.suggestions
      ? { updatedPermissions: options.suggestions }
      : {}),
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
  return deny(answers.map((answer) => `${answer.question}\n${answer.answer}`).join('\n\n'));
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

// An MCP tool reaches this callback namespaced as `mcp__<server>__<tool>`.
function mcpTarget(toolName: string): { serverName: string; toolName: string } {
  const match = /^mcp__([^_].*?)__([^_].*)$/i.exec(toolName);
  return match ? { serverName: match[1], toolName: match[2] } : { serverName: '', toolName };
}

// The key an "always allow" grant is stored under, scoped exactly the way Droid
// scopes its own (normalize.ts): a command, a file path, or an MCP server and
// tool — and, for a DROIDEX automation mutation, the arguments too, so one
// grant cannot authorize a later call that changes something else. An empty
// result leaves the request ineligible for always-allow.
function permissionSignature(
  kind: PermissionKind,
  mcp: { serverName: string; toolName: string } | undefined,
  input: Record<string, unknown>,
): string | undefined {
  if (kind === 'exec') return text(input.command) && `exec::${String(input.command)}`;
  if (kind === 'edit' || kind === 'create') {
    const path = text(input.file_path) ?? text(input.notebook_path);
    return path ? `${kind}::${path}` : undefined;
  }
  if (!mcp) return undefined;
  const key = `mcp::${mcp.serverName}::${mcp.toolName}`;
  if (!isAutomationMutationTool(mcp.serverName, mcp.toolName)) return key;
  const args = toolArgumentDigest(input);
  return args ? `${key}::${args}` : undefined;
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

function interrupted(signal: AbortSignal): Promise<typeof INTERRUPTED> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(INTERRUPTED);
      return;
    }
    signal.addEventListener('abort', () => {
      resolve(INTERRUPTED);
    });
  });
}
