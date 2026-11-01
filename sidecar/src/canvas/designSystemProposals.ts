// The one agent proposal a user kit may have waiting (design system documents
// spec §11): `<id>/proposal.json`, the whole proposed version and the version
// it was made on. A new proposal replaces the earlier one under a new ID, so
// the user accepts or discards the one they reviewed: accepting saves it as the
// kit's next version by the agent that proposed it, and discarding removes it.
// Neither tells the agent anything: its next read shows the outcome.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canvasError } from './canvasError.js';
import { announceDesignSystemChange } from './designSystemChanges.js';
import { withNoteAuthors } from './designSystemDocument.js';
import {
  designSystemKind,
  designSystemSchema,
  readDesignSystem,
  refuseDeleted,
  refuseStaleBase,
  saveDesignSystem,
  wasSavedBy,
  type DesignSystem,
} from './designSystems.js';
import {
  exists,
  proposalPath,
  queueKitWrite,
  readSavedFile,
  receiptPath,
  removeFile,
  replaceFile,
  setMarker,
} from './designSystemStorage.js';
import type { DesignSystemProposalRef, DesignSystemRef } from './protocol.js';
import { canvasIdentifierSchema } from './schema.js';

const storedProposalSchema = z
  .object({
    proposalId: canvasIdentifierSchema,
    baseVersion: z.number().int().positive().safe(),
    proposedAt: z.string().datetime(),
    appSessionId: z.string().min(1).max(200),
    system: designSystemSchema,
  })
  .strict();
type StoredProposal = z.infer<typeof storedProposalSchema>;

/** A pending proposal as the document reviews it: everything but its source. */
export interface DesignSystemProposal {
  /** A proposal is never changed, only replaced by one with another ID. */
  proposalId: string;
  baseVersion: number;
  proposedAt: string;
  /** The chat whose agent proposed it, never a provider session. */
  appSessionId: string;
  name: string;
  cover: DesignSystem['cover'];
  sections: DesignSystem['sections'];
}

const PRESET_MESSAGE = 'Presets are read-only. Save a copy of it as a new design system.';
const GONE = 'That agent proposal is no longer waiting for review.';

/**
 * Makes `system` the kit's pending proposal against `baseVersion`, replacing an
 * earlier one, with each note it changed against the base the agent's (§2). A
 * retry with the same mutation ID changes nothing; a base that is no longer the
 * latest is refused and writes nothing.
 */
export async function proposeDesignSystem(
  system: Omit<DesignSystem, 'version'>,
  options: {
    mutationId: string;
    baseVersion: number;
    appSessionId: string;
    beforePublish: () => void;
  },
): Promise<void> {
  const { id } = system;
  const { mutationId, baseVersion, appSessionId } = options;
  if (designSystemKind(id) !== 'user') throw canvasError('preset_read_only', PRESET_MESSAGE);
  const parsed = designSystemSchema.safeParse({ ...system, version: baseVersion + 1 });
  if (!parsed.success)
    throw canvasError('invalid_input', parsed.error.issues[0]?.message ?? 'That kit is not valid.');
  const base = await readDesignSystem({ id, version: baseVersion });
  const proposal: StoredProposal = {
    proposalId: randomUUID(),
    baseVersion,
    proposedAt: new Date().toISOString(),
    appSessionId,
    system: {
      ...parsed.data,
      sections: withNoteAuthors(parsed.data.sections, base.sections, 'agent'),
    },
  };
  const receipt = receiptPath(id, mutationId);
  await queueKitWrite(id, async () => {
    if (await exists(receipt)) return;
    await refuseDeleted(id);
    await refuseStaleBase(id, baseVersion);
    await replaceFile(proposalPath(id), JSON.stringify(proposal), options.beforePublish);
    await setMarker(receipt, true);
  });
  announceDesignSystemChange(id);
}

/** The kit's pending proposal without its source; built-in kits have none. */
export async function readProposal(id: string): Promise<DesignSystemProposal | null> {
  if (designSystemKind(id) !== 'user') return null;
  const stored = await readStored(id);
  if (!stored) return null;
  const { proposalId, baseVersion, proposedAt, appSessionId, system } = stored;
  const { name, cover, sections } = system;
  return { proposalId, baseVersion, proposedAt, appSessionId, name, cover, sections };
}

/** The whole proposed kit, source included, while that proposal is the one waiting. */
export async function readProposedSystem(ref: Omit<DesignSystemProposalRef, 'mode'>) {
  const stored = designSystemKind(ref.id) === 'user' ? await readStored(ref.id) : null;
  if (stored?.proposalId !== ref.proposalId) throw canvasError('invalid_input', GONE);
  return stored.system;
}

/**
 * Saves the proposal the user reviewed as the version after `onto`, the latest
 * they saw, and removes it. `onto` may be newer than the proposal's base when
 * the user accepts over it. A stale `onto` is refused and keeps the proposal. A
 * retry after success answers with the version it saved and leaves any later
 * proposal alone.
 */
export async function acceptProposal(
  id: string,
  accept: { proposalId: string; mutationId: string; onto: number },
): Promise<DesignSystemRef> {
  const { proposalId, mutationId, onto } = accept;
  const ref = await queueKitWrite(id, async () => {
    const stored = await readStored(id);
    const isWaiting = stored?.proposalId === proposalId;
    const saved = { id, version: onto + 1 };
    if (await wasSavedBy(saved, mutationId)) {
      // The first attempt saved and may not have removed the proposal it saved.
      if (isWaiting) await removeFile(proposalPath(id));
      return { ...saved, mode: 'light' as const };
    }
    if (!isWaiting) {
      // An accept, save or restore that won the race says which version it made.
      await refuseStaleBase(id, onto);
      throw canvasError('invalid_input', GONE);
    }
    const accepted = await saveDesignSystem(stored.system, {
      mutationId,
      baseVersion: onto,
      savedBy: { actor: 'agent', appSessionId: stored.appSessionId },
    });
    await removeFile(proposalPath(id));
    return accepted;
  });
  // The save announced its version while the proposal was still on disk.
  announceDesignSystemChange(id);
  return ref;
}

/** Removes that proposal; one that replaced it stays for review. */
export async function discardProposal(id: string, proposalId: string): Promise<void> {
  await queueKitWrite(id, async () => {
    if ((await readStored(id))?.proposalId === proposalId) await removeFile(proposalPath(id));
  });
  announceDesignSystemChange(id);
}

// A damaged proposal hides only itself: the kit and its versions stay usable,
// and the next proposal replaces the file.
async function readStored(id: string): Promise<StoredProposal | null> {
  const saved = await readSavedFile(proposalPath(id));
  if (saved === null) return null;
  const { data } = storedProposalSchema.safeParse(parseJson(saved.text));
  if (data?.system.id === id && data.system.version === data.baseVersion + 1) return data;
  console.warn(`The agent proposal for design system ${id} is damaged and was ignored.`);
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
