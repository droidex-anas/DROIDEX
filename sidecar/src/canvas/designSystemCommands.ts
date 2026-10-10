// The Manage design systems dialog's commands (spec §10). Kits are global, so
// these need no canvas, attachment or scope; they read and save through the
// same owner as the agent's canvas_theme tool.

import { canvasError } from './canvasError.js';
import { importDesignSystem, unmappedKitTokens } from './designSystemImport.js';
import { listDesignSystems, readDesignSystem, saveDesignSystem } from './designSystems.js';
import type { CanvasCommand, CanvasReply } from './protocol.js';

export type DesignSystemCommand = Extract<
  CanvasCommand,
  {
    type: `canvas.${
      | 'listDesignSystems'
      | 'readDesignSystem'
      | 'copyDesignSystem'
      | 'importDesignSystem'}`;
  }
>;

const COMMAND_TYPES = new Set<CanvasCommand['type']>([
  'canvas.listDesignSystems',
  'canvas.readDesignSystem',
  'canvas.copyDesignSystem',
  'canvas.importDesignSystem',
]);

export function isDesignSystemCommand(command: CanvasCommand): command is DesignSystemCommand {
  return COMMAND_TYPES.has(command.type);
}

// A new kit's id is its mutationId: a retried save finds the version it already
// published and answers with it instead of saving a second kit.
export async function answerDesignSystemCommand(
  command: DesignSystemCommand,
): Promise<CanvasReply> {
  switch (command.type) {
    case 'canvas.listDesignSystems':
      return { kind: 'designSystems', systems: await listDesignSystems() };
    case 'canvas.readDesignSystem': {
      const system = await readDesignSystem(command.ref);
      return {
        kind: 'designSystem',
        system: {
          id: system.id,
          version: system.version,
          name: system.name,
          modes: system.modes,
          unmapped: unmappedKitTokens(system),
          provenance: system.provenance ?? null,
        },
      };
    }
    case 'canvas.copyDesignSystem': {
      const original = await readDesignSystem(command.source);
      const ref = await saveDesignSystem(
        {
          ...original,
          id: command.mutationId,
          version: 1,
          name: command.name,
          provenance: { copiedFrom: { id: original.id, version: original.version } },
        },
        { mutationId: command.mutationId },
      );
      return {
        kind: 'designSystemSaved',
        ref: { id: ref.id, version: ref.version },
        diagnostics: [],
      };
    }
    case 'canvas.importDesignSystem': {
      const imported = importDesignSystem(command.source, {
        id: command.mutationId,
        name: command.name,
      });
      if (imported.status === 'refused')
        throw canvasError('invalid_input', imported.diagnostics[0].message);
      const ref = await saveDesignSystem(imported.system, { mutationId: command.mutationId });
      return {
        kind: 'designSystemSaved',
        ref: { id: ref.id, version: ref.version },
        diagnostics: imported.diagnostics,
      };
    }
  }
}
