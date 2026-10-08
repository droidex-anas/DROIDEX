import type { ClientCommand } from '../../types/bridge';

/** One send owns its intent; retries retain the create request's mutation ID. */
export function canvasIntentForDraft(
  draft: { canvasId: string | null } | null,
  prompt: string,
  mutationId: string,
): Extract<ClientCommand, { type: 'session.create' }>['canvas'] {
  if (!draft) return undefined;
  const name = draft.canvasId === null ? provisionalCanvasName(prompt) : null;
  return { canvasId: draft.canvasId, mutationId, ...(name ? { name } : {}) };
}

/** How long a provisional name may be, matching the sidecar's name rule. */
const MAX_CANVAS_NAME_LENGTH = 120;

/**
 * The name a new canvas takes from the prompt that asked for it, until the
 * agent's first design names it (spec §4). Null when the prompt says nothing
 * nameable, which leaves the sidecar's own name in place.
 */
function provisionalCanvasName(prompt: string): string | null {
  const firstLine = prompt
    .split('\n', 1)[0]
    // eslint-disable-next-line no-control-regex -- Match canvasNameSchema's rejected control ranges.
    .replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ')
    .trim();
  if (!firstLine) return null;
  const whole =
    firstLine.length <= MAX_CANVAS_NAME_LENGTH
      ? firstLine
      : firstLine.slice(0, MAX_CANVAS_NAME_LENGTH).replace(/\s\S*$/, '');
  return whole.replace(/[\s.,;:!?-]+$/, '') || null;
}
