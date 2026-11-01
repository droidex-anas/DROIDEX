// The design system document's commands (design system documents spec §14).
// Kits are global, so these need no canvas, attachment or scope; they read and
// save through the same owner as the agent's canvas_theme tool.

import { canvasError } from './canvasError.js';
import type { DocumentSection } from './designSystemDocument.js';
import { importDesignSystem, pastedSource, unmappedKitTokens } from './designSystemImport.js';
import {
  designSystemKind,
  listDesignSystems,
  listDesignSystemVersions,
  readDesignSystem,
  saveDesignSystem,
  setDesignSystemDeleted,
  type DesignSystem,
  type DesignSystemCover,
  type DesignSystemProvenance,
  type DesignSystemSummary,
  type SavedBy,
} from './designSystems.js';
import { readKitCapture, saveKitCapture } from './kitCaptures.js';
import type { KitPreviews } from './kitPreviews.js';
import type { CanvasCommand, CanvasReply, DesignSystemVersionRef } from './protocol.js';

/** A kit version as its document shows it: everything but its source. */
export interface DesignSystemDocumentView {
  id: string;
  version: number;
  /** The kit's newest version, which a save must build on. */
  latestVersion: number;
  name: string;
  kind: DesignSystemSummary['kind'];
  cover: DesignSystemCover;
  sections: DocumentSection[];
  /** The example file names its previews may name. */
  examples: string[];
  /** Tokens the shared primitives do not read, kept under their own names. */
  unmapped: string[];
  provenance: DesignSystemProvenance | null;
  /** When and by whom this version was saved; a built-in kit was never saved. */
  savedAt: string | null;
  savedBy: SavedBy | null;
  /** An agent proposal waiting for review; none until proposals exist. */
  proposal: null;
}

export type DesignSystemCommand = Extract<
  CanvasCommand,
  {
    type: `canvas.${
      | 'listDesignSystems'
      | 'readDesignSystem'
      | 'saveDesignSystem'
      | 'listDesignSystemVersions'
      | 'restoreDesignSystemVersion'
      | 'setDesignSystemDeleted'
      | 'copyDesignSystem'
      | 'importDesignSystem'
      | 'readKitPreview'
      | 'saveKitCapture'
      | 'readKitCapture'}`;
  }
>;

const COMMAND_TYPES = new Set<CanvasCommand['type']>([
  'canvas.listDesignSystems',
  'canvas.readDesignSystem',
  'canvas.saveDesignSystem',
  'canvas.listDesignSystemVersions',
  'canvas.restoreDesignSystemVersion',
  'canvas.setDesignSystemDeleted',
  'canvas.copyDesignSystem',
  'canvas.importDesignSystem',
  'canvas.readKitPreview',
  'canvas.saveKitCapture',
  'canvas.readKitCapture',
]);

const BY_USER: SavedBy = { actor: 'user' };

export function isDesignSystemCommand(command: CanvasCommand): command is DesignSystemCommand {
  return COMMAND_TYPES.has(command.type);
}

export async function answerDesignSystemCommand(
  command: DesignSystemCommand,
  previews: KitPreviews,
): Promise<CanvasReply> {
  switch (command.type) {
    case 'canvas.listDesignSystems':
      return { kind: 'designSystems', systems: await listDesignSystems() };
    case 'canvas.readDesignSystem':
      return { kind: 'designSystem', system: await readDocument(command.ref) };
    case 'canvas.listDesignSystemVersions':
      return { kind: 'designSystemVersions', versions: await listDesignSystemVersions(command.id) };
    case 'canvas.saveDesignSystem': {
      // The document edits only what it shows; source and examples stay the base's.
      const base = await readDesignSystem({ id: command.id, version: command.baseVersion });
      const ref = await saveDesignSystem(
        { ...base, name: command.name, cover: command.cover, sections: command.sections },
        { mutationId: command.mutationId, baseVersion: command.baseVersion, savedBy: BY_USER },
      );
      return saved(ref, []);
    }
    case 'canvas.restoreDesignSystemVersion': {
      const ref = await saveDesignSystem(await readDesignSystem(command), {
        mutationId: command.mutationId,
        baseVersion: command.onto,
        savedBy: BY_USER,
      });
      return saved(ref, []);
    }
    case 'canvas.setDesignSystemDeleted':
      await setDesignSystemDeleted(command.id, command.deleted, command.mutationId);
      return { kind: 'ok' };
    // A new kit's id is its mutationId: a retried save finds the version it
    // already published and answers with it instead of saving a second kit.
    case 'canvas.copyDesignSystem': {
      const original = await readDesignSystem(command.source);
      const ref = await saveDesignSystem(
        {
          ...original,
          id: command.mutationId,
          name: command.name,
          provenance: { copiedFrom: { id: original.id, version: original.version } },
        },
        { mutationId: command.mutationId, baseVersion: null, savedBy: BY_USER },
      );
      return saved(ref, []);
    }
    case 'canvas.importDesignSystem': {
      const imported = importDesignSystem([pastedSource(command.source)], {
        id: command.mutationId,
        name: command.name,
      });
      if (imported.status === 'refused')
        throw canvasError('invalid_input', imported.diagnostics[0].message);
      const ref = await saveDesignSystem(imported.system, {
        mutationId: command.mutationId,
        baseVersion: null,
        savedBy: BY_USER,
      });
      return saved(ref, imported.diagnostics);
    }
    case 'canvas.readKitPreview':
      return { kind: 'kitPreview', preview: await previews.read(command.ref, command.item) };
    case 'canvas.saveKitCapture':
      await saveKitCapture(command.ref, command.item, Buffer.from(command.png, 'base64'));
      return { kind: 'ok' };
    case 'canvas.readKitCapture': {
      const png = await readKitCapture(command.ref, command.item);
      return { kind: 'kitCapture', png: png?.toString('base64') ?? null };
    }
  }
}

function saved(
  ref: DesignSystemVersionRef,
  diagnostics: Extract<CanvasReply, { kind: 'designSystemSaved' }>['diagnostics'],
): CanvasReply {
  return { kind: 'designSystemSaved', ref: { id: ref.id, version: ref.version }, diagnostics };
}

async function readDocument(ref: DesignSystemVersionRef): Promise<DesignSystemDocumentView> {
  const system: DesignSystem = await readDesignSystem(ref);
  const versions = await listDesignSystemVersions(ref.id);
  const entry = versions.find((candidate) => candidate.version === system.version);
  return {
    id: system.id,
    version: system.version,
    latestVersion: versions[0]?.version ?? system.version,
    name: system.name,
    kind: designSystemKind(system.id),
    cover: system.cover,
    sections: system.sections,
    examples: Object.keys(system.examples).sort(),
    unmapped: unmappedKitTokens(system),
    provenance: system.provenance ?? null,
    savedAt: entry?.savedAt ?? null,
    savedBy: entry?.savedBy ?? null,
    proposal: null,
  };
}
