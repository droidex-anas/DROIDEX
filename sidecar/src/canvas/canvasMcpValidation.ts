import type { DroidTool } from '@factory/droid-sdk';
import { z } from 'zod';
import { canvasError, type CanvasCommandError, UNKNOWN_SCOPE } from './canvasError.js';

export function invalidCanvasArguments(error: z.ZodError): CanvasCommandError {
  const issue = error.issues[0];
  if (
    issue.path[0] === 'scopeId' &&
    issue.code === 'invalid_type' &&
    issue.received === 'undefined'
  )
    return canvasError('invalid_input', UNKNOWN_SCOPE);
  const sourcePath = issue.path.includes('files') || issue.path.includes('deletedPaths');
  const safeMessage = ['custom', 'too_small', 'too_big'].includes(issue.code)
    ? issue.message
    : 'Invalid Canvas input. Check the tool schema and retry.';
  return canvasError(sourcePath ? 'invalid_source_path' : 'invalid_input', safeMessage);
}

export function validateCanvasTool(entry: DroidTool): DroidTool {
  const schema = z.object(entry.inputSchema ?? {}).strict();
  return {
    ...entry,
    async handler(input) {
      try {
        return await entry.handler(schema.parse(input));
      } catch (error) {
        if (!(error instanceof z.ZodError)) throw error;
        const failure = invalidCanvasArguments(error);
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({ ok: false, code: failure.code, message: failure.message }),
            },
          ],
        };
      }
    },
  };
}
