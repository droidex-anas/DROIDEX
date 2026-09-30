import type { ProjectService } from './ProjectService.js';

let ready: Promise<ProjectService> | undefined;

/**
 * Projects stay wired outside SessionManager, so the per-session thread tools
 * resolve the one service the sidecar opened instead of holding a reference.
 */
export function registerProjectService(service: Promise<ProjectService>): void {
  ready = service;
}

export async function requireProjectService(): Promise<ProjectService> {
  if (!ready) throw new Error('Projects are not available in this DROIDEX runtime.');
  return await ready;
}
