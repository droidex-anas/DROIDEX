import type { ProjectService } from './ProjectService.js';

let service: ProjectService | undefined;

export function setProjectService(value: ProjectService): void { service = value; }

export function getProjectService(): ProjectService {
  if (!service) throw new Error('Projects are not ready.');
  return service;
}
