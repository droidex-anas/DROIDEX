import { DESIGN_SESSION_GUIDANCE } from '../../canvas/designSessionGuidance.js';
import { objectValue } from '../../values.js';
import type { AppServerClient } from './appServer.js';

export async function designDeveloperInstructions(
  client: AppServerClient,
  cwd: string,
): Promise<string> {
  // Resolve config, not stored thread context: a resumed thread already carries
  // the profile, while config/read returns the user's effective project settings.
  const response = await client.request<unknown>('config/read', { cwd });
  const config = objectValue(objectValue(response)?.config);
  const configured = config?.developer_instructions;
  if (!config || (configured != null && typeof configured !== 'string')) {
    throw new Error('Codex returned invalid developer instructions for this project.');
  }
  if (typeof configured !== 'string' || !configured.trim()) return DESIGN_SESSION_GUIDANCE;
  return `${configured}\n\n${DESIGN_SESSION_GUIDANCE}`;
}
