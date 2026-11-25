import type { ModelSwitch, SessionRole } from './sessions.js';

export interface AgentProcess {
  pid: number;
  name: string;
  command: string;
  originCommand?: string;
  startedAt: number;
  ports: number[];
}

export interface TranscriptEvent {
  id: string;
  appSessionId: string;
  sourceSessionId: string;
  role: SessionRole;
  ts: number;
  // Monotonic canonical order for primary-session scrollback, stamped during
  // replay from the compaction-chain position. Survives equal `ts` collisions
  // so restored history never reorders. Live events omit it (they are newest).
  seq?: number;
  endTs?: number;
  // Provider-native position a fork can branch from: the Droid message id, the
  // Codex turn id, or the Claude prompt uuid of the turn that produced the event.
  forkPointId?: string;
  kind: 'text' | 'thinking' | 'tool_call' | 'tool_result' | 'error' | 'status' | 'compaction';
  text?: string;
  // Native text/thinking items remain one message across interleaved streams and replay.
  textUpdate?: { messageId: string; kind: 'delta' | 'snapshot' };
  toolName?: string;
  toolArgs?: unknown;
  toolUseId?: string;
  // Safe Canvas tool snapshot. Tool-call merges prefer the latest activity,
  // but missing or untargeted snapshots cannot replace a targeted activity.
  canvasActivity?: CanvasActivity;
  isError?: boolean;
  // A 'tool_call' the provider knows is about a child session it is already
  // tracking: polling that agent for output, or stopping it. The same tool
  // names also read and stop background shell commands, so only the provider
  // can tell the two apart, and the feed must not guess from the name.
  pollsChildSessionId?: string;
  // A 'tool_result' for a call that never ran because the user stopped the
  // turn, with Stop or Send now. Reported by the harness, not inferred from the
  // text: it is not a failure and must not read as one.
  interrupted?: true;
  // The pictures a 'tool_result' carried (a screenshot, an image file the agent
  // read), as files saved in the profile. Their bytes are never in `text`.
  images?: string[];
  // For a 'compaction' divider: how many messages the compaction summarized away.
  removedCount?: number;
  author?: 'user';
  // Frontend display metadata for user-authored prompt chips.
  skills?: string[];
  files?: string[];
  browserRefs?: BrowserTranscriptReference[];
  // Side-chat answers the user attached to this prompt.
  sideChatReplies?: string[];
  // Names of the canvas frames the user pinned to this prompt.
  canvasFrames?: string[];
  // What the chips call the kit components the user tagged in this prompt.
  canvasComponents?: string[];
  steered?: boolean;
  // Links the delivered user row to its pending steer, including ordinary-turn fallback.
  steerId?: string;
  // Set on a row whose text was said out loud in a voice conversation.
  spoken?: boolean;
  compactType?: 'auto' | 'manual';
  modelSwitch?: ModelSwitch;
  errorKind?: 'usage_limit';
  resetsAt?: number;
  // A row that only says what is happening right now: a 'status' row (booting
  // a CLI, stopping a turn to send now), or a 'tool_call' snapshot of a call
  // whose input is still streaming. It is shown live and never stored, so
  // reopening the session does not replay stale progress.
  transient?: true;
}

export type BrowserTranscriptReferenceKind = 'element' | 'region' | 'text';

export interface BrowserTranscriptReference {
  id: string;
  label: string;
  kind: BrowserTranscriptReferenceKind;
  url?: string;
  selector?: string;
  imageDataUrl?: string;
}

export type PermissionKind =
  | 'edit'
  | 'exec'
  | 'create'
  | 'apply_patch'
  | 'mcp'
  | 'spec'
  | 'mission_plan'
  | 'other';

export type ConfigurableSessionRole = 'primary' | 'worker' | 'validator';

export interface PermissionRequest {
  appSessionId: string;
  requestId: string;
  kind: PermissionKind;
  title: string;
  detail: string; // Concrete command, file path, or tool input.
  canAlwaysAllow: boolean;
  diff?: string;
  plan?: string; // full plan/spec body (exit_spec_mode)
  options?: string[]; // custom option names offered by the tool
  raw: unknown;
}

export interface SessionQuestion {
  appSessionId: string;
  requestId: string;
  questions: {
    index: number;
    question: string;
    header?: string;
    options: { label: string; description?: string }[];
    multiSelect?: boolean;
  }[];
}

export interface QuestionAnswer {
  index: number;
  question: string;
  selected: string[];
  custom?: string;
}

export interface CanvasActivity {
  toolUseId: string;
  action: 'create' | 'write' | 'inspect' | 'arrange' | 'annotate' | 'theme' | 'image';
  designIds: string[];
  state: 'running' | 'completed' | 'failed';
  message: string;
  /** The canvas a create or write changed, as its reply named it. */
  canvasId?: string;
  /** The name of the first frame a create reserved. */
  title?: string;
  /** The revision a write committed. */
  revisionId?: string;
  /** This create gave an unattached chat its canvas, so it is the chat's first artifact. */
  firstArtifact?: true;
  /** The kit a theme call saved, proposed or applied; its reference only, never its content. */
  designSystem?: KitReference;
}

/** A proposal's version is the one it was made on. */
export interface KitReference {
  id: string;
  version: number;
  status: 'saved' | 'proposed' | 'applied';
}
