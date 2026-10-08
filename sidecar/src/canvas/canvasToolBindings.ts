import { appendFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { droidexUserDataDir } from '../droidexPaths.js';
import { objectValue } from '../values.js';
import { safeFrameName, type CanvasToolBinding } from './canvasToolPresentation.js';

const ACTIONS: CanvasToolBinding['action'][] = ['create', 'write', 'inspect', 'arrange', 'theme'];

function pathFor(appSessionId: string): string {
  return join(
    droidexUserDataDir(),
    'canvas-tool-bindings',
    `${encodeURIComponent(appSessionId)}.jsonl`,
  );
}

export function appendCanvasToolBinding(appSessionId: string, binding: CanvasToolBinding): void {
  mkdirSync(join(droidexUserDataDir(), 'canvas-tool-bindings'), { recursive: true });
  appendFileSync(pathFor(appSessionId), `${JSON.stringify(binding)}\n`);
}

export function canvasToolBindingsRevision(appSessionId: string): string {
  try {
    const stat = statSync(pathFor(appSessionId));
    return `${String(stat.mtimeMs)}:${String(stat.size)}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

export function readCanvasToolBindings(appSessionId: string): CanvasToolBinding[] {
  let content: string;
  try {
    content = readFileSync(pathFor(appSessionId), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const bindings: CanvasToolBinding[] = [];
  for (const line of content.split('\n')) {
    if (!line) continue;
    try {
      const value = objectValue(JSON.parse(line));
      if (
        !value ||
        typeof value.occurrenceId !== 'string' ||
        !value.occurrenceId ||
        typeof value.toolUseId !== 'string' ||
        !value.toolUseId ||
        typeof value.sourceSessionId !== 'string' ||
        !value.sourceSessionId
      )
        continue;
      const action = ACTIONS.find((item) => item === value.action);
      if (!action) continue;
      if (!Array.isArray(value.designIds)) continue;
      const rawIds: unknown[] = value.designIds;
      const designIds = rawIds.filter(
        (id): id is string => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id),
      );
      if (designIds.length !== rawIds.length) continue;
      const revisionId = value.revisionId;
      const frameNames = value.frameNames;
      const rawNames: unknown[] = Array.isArray(frameNames) ? frameNames : [];
      const safeNames = rawNames.filter(
        (name): name is string => typeof name === 'string' && safeFrameName(name) === name,
      );
      bindings.push({
        occurrenceId: value.occurrenceId,
        toolUseId: value.toolUseId,
        sourceSessionId: value.sourceSessionId,
        action,
        designIds,
        ...(typeof revisionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(revisionId)
          ? { revisionId }
          : {}),
        ...(Array.isArray(frameNames) &&
        safeNames.length === rawNames.length &&
        safeNames.length <= 50
          ? { frameNames: safeNames }
          : {}),
      });
    } catch {
      // A torn last write cannot hide earlier correlations.
    }
  }
  return bindings;
}
