// How DROIDEX's autonomy levels and approval cards meet Codex's approval
// protocol: the sandbox a thread and a turn run under, the decision sent back
// for an approval request, and the answers sent back for a mid-turn question.
import type {
  Autonomy,
  PermissionKind,
  PermissionOutcome,
  SessionSummary,
} from '../../protocol.js';
import { nextInteractionRequestId, type ProviderInteractions } from '../interactions.js';
import type { AppServerClient } from './appServer.js';

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

// Low keeps command approvals while the adapter accepts eligible workspace edits.
const AUTONOMY: Record<Autonomy, { approvalPolicy: AskForApproval; sandbox: SandboxMode }> = {
  off: { approvalPolicy: 'untrusted', sandbox: 'read-only' },
  low: { approvalPolicy: 'untrusted', sandbox: 'workspace-write' },
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
  kind: Extract<PermissionKind, 'exec' | 'edit' | 'create'>;
  title: string;
  detail: string;
  diff?: string;
  // The key an always-allow grant is stored under; absent leaves the request
  // ineligible for one.
  signature?: string;
  raw: CommandApproval | FileChangeApproval;
  canApproveFor?: (actor: SessionSummary) => boolean;
}

interface CommandApproval {
  threadId: string;
  turnId: string;
  itemId: string;
  command?: string | null;
  reason?: string | null;
  commandActions?: { command: string }[] | null;
}

interface FileChangeApproval {
  itemId: string;
  threadId: string;
  turnId: string;
  grantRoot?: string | null;
  reason?: string | null;
}

// What the user is being asked to allow. A command request describes itself; a
// file-change request carries no description at all, so the open item the event
// mapper is tracking is the only thing that can name the files.
function commandApproval(params: CommandApproval): CodexApproval {
  const actions = params.commandActions ?? [];
  const command = params.command ?? actions.map((action) => action.command).join('; ');
  // The grant key is the exact action list, serialized: two different lists can
  // join into the same string, and one grant must never cover the other.
  const grant = params.command ?? (actions.length > 0 ? JSON.stringify(actions) : '');
  return {
    kind: 'exec',
    title: params.reason ?? '',
    detail: command,
    ...(grant ? { signature: `exec::${grant}` } : {}),
    raw: params,
  };
}

// What a pending file change is about, read off the item Codex is tracking.
export interface FileChangeDetail {
  detail: string;
  diff?: string;
  // Every file in the change is a new one.
  creates?: boolean;
}

function fileChangeApproval(
  params: FileChangeApproval,
  change: FileChangeDetail | undefined,
): CodexApproval {
  const files = change?.detail;
  return {
    kind: change?.creates ? 'create' : 'edit',
    title: params.reason ?? '',
    detail: files ?? '',
    ...(change?.diff !== undefined ? { diff: change.diff } : {}),
    ...(files ? { signature: `edit::${files}` } : {}),
    raw: params,
  };
}

async function decideApproval(
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
      canAlwaysAllow: Boolean(approval.signature),
      ...(approval.diff !== undefined ? { diff: approval.diff } : {}),
      raw: approval.raw,
    },
    confirmationType: approval.kind,
    ...(approval.signature ? { signature: approval.signature } : {}),
    ...(approval.canApproveFor ? { canApproveFor: approval.canApproveFor } : {}),
  });
  return approvalDecision(outcome);
}

function approvalDecision(outcome: PermissionOutcome): ApprovalDecision {
  if (outcome === 'proceed_always') return 'acceptForSession';
  if (outcome === 'cancel') return 'cancel';
  return outcome.startsWith('proceed') ? 'accept' : 'decline';
}

interface RequestedQuestion {
  id: string;
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: { label: string; description?: string }[] | null;
}

// Codex keys answers by question id and preserves each selection.
// An empty map is the cancellation.
async function answerQuestions(
  interactions: ProviderInteractions,
  questions: RequestedQuestion[],
): Promise<Record<string, { answers: string[] }>> {
  const { cancelled, answers } = await interactions.requestQuestion(
    questions.map((asked, index) => ({
      index,
      question: asked.question,
      options: asked.options ?? [],
      ...(asked.header !== undefined ? { header: asked.header } : {}),
      ...(asked.multiSelect !== undefined ? { multiSelect: asked.multiSelect } : {}),
    })),
  );
  if (cancelled) return {};
  const byId: Record<string, { answers: string[] }> = {};
  for (const answer of answers) {
    const id = questions[answer.index]?.id;
    if (id) byId[id] = { answers: [...answer.selected, ...(answer.custom ? [answer.custom] : [])] };
  }
  return byId;
}

// One session's prompt channel: the approval and question requests Codex sends,
// and the cards they are waiting on. A turn that ends first has to take them off
// the screen, since settling only Codex's side would leave the prompt and its
// waiter behind, under the next turn.
export class OpenPrompts {
  private open = 0;

  constructor(
    private readonly appSessionId: string,
    private readonly interactions: ProviderInteractions,
  ) {}

  // File-change requests take their paths and diff from the tracked item.
  register(
    client: Pick<AppServerClient, 'onRequest'>,
    fileDetail: (itemId: string) => FileChangeDetail | undefined,
    canAutoApprove: (approval: CodexApproval) => boolean,
    ownerCanApproveEdits: (request: FileChangeApproval, actor: SessionSummary) => boolean,
  ): void {
    client.onRequest('item/commandExecution/requestApproval', (params) => {
      const approval = commandApproval(params as CommandApproval);
      if (canAutoApprove(approval)) return Promise.resolve({ decision: 'accept' });
      return this.decide(approval);
    });
    client.onRequest('item/fileChange/requestApproval', async (params) => {
      const request = params as FileChangeApproval;
      const approval: CodexApproval = {
        ...fileChangeApproval(request, fileDetail(request.itemId)),
        canApproveFor: (actor) => request.grantRoot == null && ownerCanApproveEdits(request, actor),
      };
      if (canAutoApprove(approval)) return { decision: 'accept' };
      return this.decide(approval);
    });
    client.onRequest('item/tool/requestUserInput', async (params) => {
      const { questions } = params as { questions: RequestedQuestion[] };
      return { answers: await this.ask(() => answerQuestions(this.interactions, questions)) };
    });
  }

  cancel(): void {
    if (this.open > 0) this.interactions.cancelPending();
  }

  private async decide(approval: CodexApproval): Promise<{ decision: ApprovalDecision }> {
    return {
      decision: await this.ask(() =>
        decideApproval(this.appSessionId, this.interactions, approval),
      ),
    };
  }

  async ask<T>(request: () => Promise<T>): Promise<T> {
    this.open += 1;
    try {
      return await request();
    } finally {
      this.open -= 1;
    }
  }
}
