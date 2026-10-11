// The annotation layer's one writer. An annotate commits on the workspace queue
// like a frame edit, under the layer's own CAS version. The user may change any
// annotation; an agent only those its own chat drew, so a user's sketch is
// read-only to every agent.

import {
  ANNOTATION_LIMITS,
  savedAnnotation,
  type AnnotateCanvasInput,
  type Annotation,
  type AnnotationAuthor,
} from './canvasAnnotationSchema.js';
import type { CanvasCommits } from './canvasCommits.js';
import { canvasError } from './canvasError.js';
import type { CanvasHeads } from './canvasHeads.js';
import type { CanvasLeases } from './canvasLeases.js';
import { mutationFingerprint, recordMutation } from './canvasManifest.js';
import { recordedAnnotate } from './canvasReceipts.js';
import type { CanvasChange, CanvasScope } from './protocol.js';

/** How many identifiers one refusal names before it only counts the rest. */
const NAMED_IDS = 8;

export class CanvasAnnotations {
  constructor(
    private readonly heads: CanvasHeads,
    private readonly leases: CanvasLeases,
    private readonly commits: CanvasCommits,
  ) {}

  annotate(scope: CanvasScope, input: AnnotateCanvasInput): Promise<CanvasChange> {
    return this.commits.admit(async () => {
      this.commits.requireOpen();
      const fingerprint = mutationFingerprint(input);
      const manifest = this.leases.requireScopedCanvas(scope);
      const recorded = recordedAnnotate(manifest, input.mutationId, fingerprint);
      if (recorded) return recorded;

      return this.commits.publish(async () => {
        const live = this.leases.requireScopedCanvas(scope);
        const again = recordedAnnotate(live, input.mutationId, fingerprint);
        if (again) return { value: again };
        if (live.annotationsVersion !== input.expectedAnnotationsVersion)
          throw canvasError(
            'revision_conflict',
            'The annotations changed. Read them again and apply your change again.',
          );
        const author = authorOf(scope);
        const current = new Map(live.annotations.map((entry) => [entry.id, entry]));
        requireAuthority(author, current, input);

        const now = Date.now();
        const upserted = input.upserts.map((draft) =>
          savedAnnotation(draft, author, now, current.get(draft.id)),
        );
        const redrawn = new Map(upserted.map((entry) => [entry.id, entry]));
        const removed = new Set(input.deletes);
        // A redrawn annotation keeps its place in the stack; a new one goes on top.
        const annotations = [
          ...live.annotations
            .filter((entry) => !removed.has(entry.id))
            .map((entry) => redrawn.get(entry.id) ?? entry),
          ...upserted.filter((entry) => !current.has(entry.id)),
        ];
        if (annotations.length > ANNOTATION_LIMITS.maxAnnotationsPerCanvas)
          throw canvasError(
            'invalid_input',
            `A canvas holds at most ${String(ANNOTATION_LIMITS.maxAnnotationsPerCanvas)} annotations. Remove some before adding more.`,
          );

        const next = structuredClone(live);
        next.annotations = annotations;
        next.annotationsVersion += 1;
        next.sequence += 1;
        next.updatedAt = now;
        recordMutation(
          next,
          {
            kind: 'annotate',
            mutationId: input.mutationId,
            scopeId: scope.scopeId,
            fingerprint,
            sequence: next.sequence,
            annotationsVersion: next.annotationsVersion,
            upsertedIds: upserted.map((entry) => entry.id),
            removedIds: [...input.deletes],
          },
          this.leases.isActive,
        );
        await this.heads.install(next, () => {
          this.commits.requireOpen();
          this.leases.requireScopedCanvas(scope);
        });
        const change: CanvasChange = {
          canvasId: next.canvasId,
          sequence: next.sequence,
          frames: [],
          removedDesignIds: [],
          annotations: {
            version: next.annotationsVersion,
            upserted,
            removedIds: [...input.deletes],
          },
        };
        return { value: change, change };
      });
    });
  }
}

function authorOf(scope: CanvasScope): AnnotationAuthor {
  return scope.origin === 'user' ? { kind: 'user' } : { kind: 'agent', chatId: scope.appSessionId };
}

/** Refuses the whole change when it removes what is not there or touches what it may not. */
function requireAuthority(
  author: AnnotationAuthor,
  current: ReadonlyMap<string, Annotation>,
  input: AnnotateCanvasInput,
): void {
  const missing = input.deletes.filter((id) => !current.has(id));
  if (missing.length > 0)
    throw canvasError(
      'not_found',
      `These annotations are not on this canvas: ${named(missing)}. Read the canvas again.`,
    );
  if (author.kind === 'user') return;
  const refused = [...input.upserts.map((draft) => draft.id), ...input.deletes].filter((id) => {
    const existing = current.get(id)?.author;
    if (!existing) return false;
    return existing.kind !== 'agent' || existing.chatId !== author.chatId;
  });
  if (refused.length > 0)
    throw canvasError(
      'invalid_input',
      `These annotations were drawn by the user or another chat and are read-only to you: ${named(refused)}. Leave them, and add your own annotation instead.`,
    );
}

function named(ids: readonly string[]): string {
  const shown = ids.slice(0, NAMED_IDS).join(', ');
  const rest = ids.length - NAMED_IDS;
  return rest > 0 ? `${shown} and ${String(rest)} more` : shown;
}
