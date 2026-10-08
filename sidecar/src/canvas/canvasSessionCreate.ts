import type { ClientCommand, ServerEvent, SessionSummary } from '../protocol.js';
import type { ProjectSessions } from '../projects/sessions.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import type { SessionCreateAdmission } from '../SessionCreateAdmission.js';

// Lifecycle owns admission; Canvas revalidates that create at each durable write.
export async function prepareSessionFirstTurn(
  session: SessionSummary,
  command: Pick<Extract<ClientCommand, { type: 'session.create' }>, 'clientRef' | 'canvas'>,
  projects: Pick<ProjectSessions, 'beforeFirstTurn'>,
  canvasReady: Promise<CanvasWorkspace>,
  emit: (event: ServerEvent) => void,
  admission: SessionCreateAdmission,
): Promise<void> {
  const appSessionId = session.appSessionId;
  admission.requireCurrent();
  await projects.beforeFirstTurn(session, command.clientRef);
  admission.requireCurrent();
  const intent = command.canvas;
  if (!intent) return;
  const workspace = await canvasReady;
  admission.requireCurrent();
  const canvasId = intent.canvasId;
  if (canvasId === null) {
    await workspace.createCanvas(appSessionId, intent.mutationId, intent.name, admission);
  } else {
    await workspace.attach(appSessionId, canvasId, admission);
  }
  admission.requireCurrent();
  emit({ type: 'canvas.summaries', summaries: workspace.listCanvases() });
}
