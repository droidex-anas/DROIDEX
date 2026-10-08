// The turn half of Canvas authorization (spec §6). A prompt pins its references
// when the user composes it; this module checks them where they cross into the
// sidecar, mints the lease when that request is admitted to run, registers it
// with `CanvasScopes` for the workspace to check, and revokes it wherever the
// turn ends. It keeps no scope payloads: the registry holds them, and this
// holds which turn and which provider era minted which.

import { randomUUID } from 'node:crypto';

import { canvasError, EXPIRED_TURN, UNKNOWN_SCOPE } from './canvasError.js';
import type { CanvasScopes } from './canvasScopes.js';
import { DEFAULT_DESIGN_SYSTEM_REF } from './designSystems.js';
import type { CanvasScope, CanvasTurnContext } from './protocol.js';
import { canvasTurnContextSchema } from './schema.js';

/**
 * The Canvas leases one turn holds: its own, and one per steer the model took in
 * while it ran. Revoking is idempotent and reaches only this turn's leases, so a
 * settlement that lands late cannot revoke a later turn's or a replacement
 * provider's.
 */
export interface CanvasTurnLeases {
  /** A steer the model took in: its own immutable lease, beside this turn's. */
  addSteer(context: CanvasTurnContext | undefined): void;
  revoke(): void;
}

interface ChatLease {
  scopeId: string;
  // Which turn may revoke it, so one turn's settlement leaves another's alone.
  turn: symbol;
}

interface ChatLeases {
  generation: number;
  // Oldest first: each turn's own lease, then each steer that turn took in.
  live: ChatLease[];
}

export class CanvasTurns {
  private readonly chats = new Map<string, ChatLeases>();
  // Keep issued identities, without payloads, to distinguish revocation from invention.
  private readonly scopeOwners = new Map<string, string>();
  // Provider eras stay ordered across closed chats.
  private nextGeneration = 1;

  constructor(
    private readonly scopes: Pick<CanvasScopes, 'get' | 'register' | 'revoke'>,
    /** The canvas the chat is attached to now, or null for an unattached chat. */
    private readonly attachedCanvasId: (appSessionId: string) => string | null,
  ) {}

  /**
   * Mints the lease a turn runs under, from the references its prompt pinned. A
   * prompt without chips uses the default kit and the whole canvas.
   */
  beginTurn(appSessionId: string, context: CanvasTurnContext | undefined): CanvasTurnLeases {
    const chat = this.chat(appSessionId);
    const turn = Symbol('canvasTurn');
    let settled = false;
    this.mint(appSessionId, chat, turn, context ?? emptyContext());
    return {
      addSteer: (steerContext) => {
        // A steer the harness delivered after this turn ended, or after the
        // provider that was running it was replaced, has no running turn to
        // authorize it, so it leases nothing.
        if (settled || this.chats.get(appSessionId) !== chat) return;
        this.mint(appSessionId, chat, turn, steerContext ?? emptyContext());
      },
      revoke: () => {
        settled = true;
        const others: ChatLease[] = [];
        for (const lease of chat.live) {
          if (lease.turn === turn) this.scopes.revoke(lease.scopeId);
          else others.push(lease);
        }
        chat.live = others;
      },
    };
  }

  /**
   * Ends this chat's provider era: every lease it holds is revoked, and the next
   * is minted under a later generation, so one minted before the replacement is
   * refused even if the turn that minted it lingers.
   */
  endSession(appSessionId: string): void {
    const chat = this.chats.get(appSessionId);
    if (!chat) return;
    for (const lease of chat.live) this.scopes.revoke(lease.scopeId);
    chat.live = [];
    this.chats.delete(appSessionId);
  }

  /**
   * The lease a tool call binds to when it names none: the newest live one,
   * which is a steer's while the running turn holds a steer the model took in.
   * Every earlier lease stays valid and may still be presented by ID, so a call
   * already in flight is answered rather than retargeted (spec §6).
   */
  activeScope(appSessionId: string): CanvasScope | undefined {
    const lease = this.chats.get(appSessionId)?.live.at(-1);
    return lease && this.scopes.get(lease.scopeId);
  }

  /**
   * Resolve an issued turn lease. A model call also names its endpoint's chat;
   * unknown and foreign IDs are invalid input, while revoked leases are expired.
   */
  requireScope(scopeId: string, appSessionId?: string): Extract<CanvasScope, { origin: 'turn' }> {
    const owner = this.scopeOwners.get(scopeId);
    if (!owner || (appSessionId !== undefined && owner !== appSessionId))
      throw canvasError('invalid_input', UNKNOWN_SCOPE);
    const scope = this.scopes.get(scopeId);
    if (scope?.origin !== 'turn') throw canvasError('scope_expired', EXPIRED_TURN);
    return scope;
  }

  private mint(
    appSessionId: string,
    chat: ChatLeases,
    turn: symbol,
    context: CanvasTurnContext,
  ): void {
    const scope: CanvasScope = {
      origin: 'turn',
      scopeId: `turn:${randomUUID()}`,
      appSessionId,
      generation: chat.generation,
      // Null for an unattached chat: its first canvas_create fills the binding
      // through the workspace's commit owner (spec §6).
      canvasId: this.attachedCanvasId(appSessionId),
      context,
      allowedDesignIds: pinnedDesignIds(context),
    };
    this.scopes.register(scope);
    this.scopeOwners.set(scope.scopeId, appSessionId);
    chat.live.push({ scopeId: scope.scopeId, turn });
  }

  private chat(appSessionId: string): ChatLeases {
    const existing = this.chats.get(appSessionId);
    if (existing) return existing;
    const chat: ChatLeases = { generation: this.nextGeneration++, live: [] };
    this.chats.set(appSessionId, chat);
    return chat;
  }
}

function emptyContext(): CanvasTurnContext {
  return { designs: [], elements: [], designSystem: DEFAULT_DESIGN_SYSTEM_REF };
}

/**
 * The designs a request may write: every one its chips named, whether as a frame
 * or as an element inside one. A request that pinned neither is working on the
 * canvas as a whole, which is what `CanvasLeases.requireDesigns` reads as
 * `'canvas'`.
 */
function pinnedDesignIds(context: CanvasTurnContext): string[] | 'canvas' {
  const designIds = new Set([
    ...context.designs.map((design) => design.designId),
    ...context.elements.map((element) => element.designId),
  ]);
  return designIds.size > 0 ? [...designIds] : 'canvas';
}

/**
 * The pinned references one send carries, checked where they cross into the
 * sidecar. Spec §8: only the first refinement message travels, never the
 * payload. A failed parse always carries at least one issue.
 */
export function assertCanvasTurnContext(value: unknown): void {
  const parsed = canvasTurnContextSchema.safeParse(value);
  if (parsed.success) return;
  const [issue] = parsed.error.issues;
  throw canvasError('invalid_input', issue.message);
}
