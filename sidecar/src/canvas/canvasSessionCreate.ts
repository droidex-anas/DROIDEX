import type { ClientCommand, ServerEvent, SessionSummary } from '../protocol.js';
import type { ProjectSessions } from '../projects/sessions.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';

// Lifecycle registers the chat before these commits and revalidates it before
// publication or the first lease. Projects and Canvas both own pre-turn work.
export async function prepareSessionFirstTurn(
  session: SessionSummary,
  command: Pick<Extract<ClientCommand, { type: 'session.create' }>, 'clientRef' | 'canvas'>,
  projects: Pick<ProjectSessions, 'beforeFirstTurn'>,
  canvasReady: Promise<CanvasWorkspace>,
  emit: (event: ServerEvent) => void,
): Promise<void> {
  await projects.beforeFirstTurn(session, command.clientRef);
  const intent = command.canvas;
  if (!intent) return;
  const workspace = await canvasReady;
  if (intent.canvasId === null) {
    await workspace.createCanvas(session.appSessionId, intent.mutationId, intent.name);
  } else {
    await workspace.attach(session.appSessionId, intent.canvasId);
  }
  emit({ type: 'canvas.summaries', summaries: workspace.listCanvases() });
}
