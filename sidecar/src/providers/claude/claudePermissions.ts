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
import type { Autonomy, PermissionKind, SessionQuestion } from '../../protocol.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';

// Off and Low share 'default': the CLI cannot ask for reads, but tools it has
// not already allowed must reach canUseTool rather than being silently denied.
// Medium also prompts through canUseTool; High runs unattended.
export function claudePermissionMode(autonomy: Autonomy): PermissionMode {
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

const WAIT_FOR_REVIEW = 'Stop here and wait for the user to review the plan.';

type CanUseToolOptions = Parameters<CanUseTool>[2];

export function claudeCanUseTool(
  appSessionId: string,
  interactions: ProviderInteractions,
  isPlanning: () => boolean,
): CanUseTool {
  const decide = (
    toolName: string,
    input: Record<string, unknown>,
    options: CanUseToolOptions,
  ): Promise<PermissionResult> => {
    if (toolName === 'ExitPlanMode')
      return reviewPlan(appSessionId, input, interactions, isPlanning());
    if (toolName === 'AskUserQuestion') return askUserQuestion(input, interactions);
    return approveTool(appSessionId, toolName, input, options, interactions);
  };
  return async (toolName, input, options): Promise<PermissionResult> => {
    const decision = await Promise.race([
      decide(toolName, input, options),
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

// The plan reaches the user as DROIDEX's own Spec card, so the call itself is
// always denied: allowing it would let the model act on a plan nobody has read,
// and the SDK offers no other way to hand the plan over. Approving switches the
// session out of plan mode before this returns, so the refusal that carries the
// verdict is also what starts the work.
async function reviewPlan(
  appSessionId: string,
  input: Record<string, unknown>,
  interactions: ProviderInteractions,
  planning: boolean,
): Promise<PermissionResult> {
  const plan = text(input.plan);
  // A plan submitted outside Spec is not a review the user asked for.
  if (!planning || !plan) return deny(WAIT_FOR_REVIEW);
  const outcome = await interactions.requestApproval({
    request: {
      appSessionId,
      requestId: nextInteractionRequestId(),
      kind: 'spec',
      canAlwaysAllow: false,
      title: 'Plan ready for review',
      detail: plan,
      plan,
      raw: { toolName: 'ExitPlanMode', input },
    },
    confirmationType: CONFIRMATION_TYPES.spec,
  });
  if (!outcome.startsWith('proceed')) return deny(WAIT_FOR_REVIEW);
  return deny('The user approved the plan. Plan mode is off: start implementing it now.');
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
  const canAlwaysAllow = Boolean(signature) && !options.suppressAlwaysAllowRule;
  const outcome = await interactions.requestApproval({
    request: {
      appSessionId,
      requestId: nextInteractionRequestId(),
      kind,
      canAlwaysAllow,
      title: options.title ?? options.description ?? options.displayName ?? toolName,
      detail: describeInput(input),
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
    ...(outcome === 'proceed_always' && canAlwaysAllow && options.suggestions
      ? { updatedPermissions: options.suggestions }
      : {}),
  };
}

async function askUserQuestion(
  input: Record<string, unknown>,
  interactions: ProviderInteractions,
): Promise<PermissionResult> {
  const asked = askedQuestions(input);
  if (asked.length === 0) return deny('No question was asked.');
  const { cancelled, answers } = await interactions.requestQuestion(asked);
  if (cancelled) return deny('The user dismissed the question.');
  const byQuestion: Record<string, string> = {};
  for (const answer of answers) {
    const question = asked.find((question) => question.index === answer.index);
    if (!question) continue;
    byQuestion[question.question] = [
      ...answer.selected,
      ...(answer.custom ? [answer.custom] : []),
    ].join(', ');
  }
  return { behavior: 'allow', updatedInput: { ...input, answers: byQuestion } };
}

interface AskedQuestion {
  question?: unknown;
  header?: unknown;
  multiSelect?: unknown;
  options?: { label?: unknown; description?: unknown }[];
}

function askedQuestions(input: Record<string, unknown>): SessionQuestion['questions'] {
  const questions = Array.isArray(input.questions) ? (input.questions as AskedQuestion[]) : [];
  return questions.flatMap((asked, index) =>
    typeof asked.question === 'string'
      ? [
          {
            index,
            question: asked.question,
            ...(typeof asked.header === 'string' ? { header: asked.header } : {}),
            ...(typeof asked.multiSelect === 'boolean' ? { multiSelect: asked.multiSelect } : {}),
            options: (asked.options ?? []).flatMap((option) =>
              typeof option.label === 'string'
                ? [
                    {
                      label: option.label,
                      ...(typeof option.description === 'string'
                        ? { description: option.description }
                        : {}),
                    },
                  ]
                : [],
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
  const concrete = text(input.command) ?? text(input.file_path) ?? text(input.notebook_path);
  if (concrete) return concrete;
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
