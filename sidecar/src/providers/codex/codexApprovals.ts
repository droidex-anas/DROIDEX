// How DROIDEX's autonomy levels and approval cards meet Codex's approval
// protocol: the sandbox a thread and a turn run under, the decision sent back
// for an approval request, and the answers sent back for a mid-turn question.
import type { Autonomy, PermissionKind, PermissionOutcome } from '../../protocol.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';

export type AskForApproval = 'untrusted' | 'on-request' | 'never';
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access';
export type SandboxPolicy =
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; networkAccess: boolean }
  | {
      type: 'workspaceWrite';
      writableRoots: string[];
      networkAccess: boolean;
      excludeTmpdirEnvVar: boolean;
      excludeSlashTmp: boolean;
    };

// 'off' asks before anything it does not already trust; 'low' and 'medium' ask
// before acting outside the workspace; 'high' runs unattended.
const AUTONOMY: Record<Autonomy, { approvalPolicy: AskForApproval; sandbox: SandboxMode }> = {
  off: { approvalPolicy: 'untrusted', sandbox: 'read-only' },
  low: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  medium: { approvalPolicy: 'on-request', sandbox: 'workspace-write' },
  high: { approvalPolicy: 'never', sandbox: 'danger-full-access' },
};

export function codexAutonomy(autonomy: Autonomy): {
  approvalPolicy: AskForApproval;
  sandbox: SandboxMode;
} {
  return AUTONOMY[autonomy];
}

// `thread/start` takes the coarse sandbox enum; `turn/start` takes this richer
// union for the same intent, so each call site gets the shape it accepts.
export function codexSandboxPolicy(sandbox: SandboxMode): SandboxPolicy {
  if (sandbox === 'danger-full-access') return { type: 'dangerFullAccess' };
  if (sandbox === 'read-only') return { type: 'readOnly', networkAccess: false };
  return {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  };
}

// `decline` lets the turn continue with something else; `cancel` ends it. They
// are not synonyms, and mapping every refusal to `cancel` would abort turns the
// user only meant to redirect.
export type ApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';

export interface CodexApproval {
  kind: Extract<PermissionKind, 'exec' | 'edit'>;
  title: string;
  detail: string;
  // The key an always-allow grant is stored under; absent leaves the request
  // ineligible for one.
  signature?: string;
  raw: unknown;
}

export interface CommandApproval {
  itemId: string;
  command?: string | null;
  reason?: string | null;
  commandActions?: { command: string }[] | null;
}

export interface FileChangeApproval {
  itemId: string;
  reason?: string | null;
}

// What the user is being asked to allow. A command request describes itself; a
// file-change request carries no description at all, so the open item the event
// mapper is tracking is the only thing that can name the files.
export function commandApproval(params: CommandApproval): CodexApproval {
  const command = params.command ?? params.commandActions?.map((a) => a.command).join('; ') ?? '';
  return {
    kind: 'exec',
    title: 'Bash',
    detail: params.reason ? `${command}\n\n${params.reason}` : command,
    ...(command ? { signature: `exec::${command}` } : {}),
    raw: params,
  };
}

export function fileChangeApproval(
  params: FileChangeApproval,
  files: string | undefined,
): CodexApproval {
  return {
    kind: 'edit',
    title: 'Edit',
    detail: params.reason ? `${files ?? ''}\n\n${params.reason}` : (files ?? 'File changes'),
    ...(files ? { signature: `edit::${files}` } : {}),
    raw: params,
  };
}

export async function decideApproval(
  appSessionId: string,
  interactions: ProviderInteractions,
  approval: CodexApproval,
): Promise<ApprovalDecision> {
  const outcome = await interactions.requestApproval({
    request: {
      appSessionId,
      requestId: nextInteractionRequestId(),
      kind: approval.kind,
      title: approval.title,
      detail: approval.detail,
      raw: approval.raw,
    },
    confirmationType: approval.kind,
    ...(approval.signature ? { signature: approval.signature } : {}),
  });
  return approvalDecision(outcome);
}

function approvalDecision(outcome: PermissionOutcome): ApprovalDecision {
  if (outcome === 'proceed_always') return 'acceptForSession';
  if (outcome === 'cancel') return 'cancel';
  return outcome.startsWith('proceed') ? 'accept' : 'decline';
}

export interface RequestedQuestion {
  id: string;
  question: string;
  options: { label: string }[] | null;
}

// Codex keys answers by question id and accepts several per question; DROIDEX
// asks one answer per question, in order. An empty map is the cancellation.
export async function answerQuestions(
  interactions: ProviderInteractions,
  questions: RequestedQuestion[],
): Promise<Record<string, { answers: string[] }>> {
  const { cancelled, answers } = await interactions.requestQuestion(
    questions.map((asked, index) => ({
      index,
      question: asked.question,
      options: (asked.options ?? []).map((option) => option.label),
    })),
  );
  if (cancelled) return {};
  const byId: Record<string, { answers: string[] }> = {};
  for (const answer of answers) {
    const id = questions[answer.index]?.id;
    if (id) byId[id] = { answers: [answer.answer] };
  }
  return byId;
}
