import type { ProjectWake } from './types.js';

const RESULT_LIMIT = 1200;

export function wakePrompt(events: readonly ProjectWake[]): string {
  return [
    '<project-events>',
    ...events.map(line),
    '</project-events>',
    'Coordinate only what needs attention. Inspect a thread when you need detail; do not ask for or restate its full transcript.',
  ].join('\n');
}

function line(event: ProjectWake): string {
  if (event.kind === 'user') return `user: ${event.text}`;
  const result = event.result?.trim().slice(0, RESULT_LIMIT);
  return `${event.kind} ${event.threadId} "${event.title}"${result ? `: ${result}` : ''}`;
}
