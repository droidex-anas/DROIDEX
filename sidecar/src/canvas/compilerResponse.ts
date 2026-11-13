// What the forked compiler sends back, read as the protocol defines it: the
// compiler is a separate process, so its replies are checked like any input
// that crosses a boundary.

import type {
  CompiledDesign,
  CompilerResponse,
  CompilerUnavailableReason,
  EditFailureCode,
} from './compiler.js';
import { moduleDeclarationsSchema } from './compilerModules.js';
import { kitFailureSchema } from './kitCatalog.js';
import type { CanvasDiagnostic } from './protocol.js';
import {
  CANVAS_LIMITS,
  outlineNodeIdSchema,
  sourceElementSchema,
  sourceFilesSchema,
  sourceOutlineSchema,
} from './schema.js';

const UNAVAILABLE_REASONS: readonly CompilerUnavailableReason[] = [
  'damaged-runtime',
  'lost-compiler',
];
const EDIT_FAILURE_CODES: readonly EditFailureCode[] = [
  'stale_reference',
  'ambiguous_element',
  'invalid_source',
  'invalid_edit',
  'unsupported_edit',
];

/**
 * The child's answer, or null when what arrived is not one: the compiler is a
 * forked process, and what it sends is the one thing in this module that is not
 * this module's own. Only the shape the protocol defines is read. An answer for
 * a request nobody is waiting for is not malformed — a cancelled compile is
 * answered after its caller has already been told, and `settle` drops it — so
 * `requestId` is checked for its type and nothing more.
 */
export function compilerResponse(message: unknown): CompilerResponse | null {
  if (typeof message !== 'object' || message === null) return null;
  const fields = message as Record<string, unknown>;
  const { requestId, status, reason, message: text, design, diagnostics } = fields;
  if (typeof requestId !== 'number') return null;
  const edit = editResponse(requestId, fields);
  if (edit !== undefined) return edit;
  const read = readResponse(requestId, fields);
  if (read !== undefined) return read;
  switch (status) {
    case 'cancelled':
    case 'stopped':
      return { requestId, status };
    case 'ready':
      return isCompiledDesign(design) ? { requestId, status, design } : null;
    case 'failed':
      return Array.isArray(diagnostics)
        ? { requestId, status, diagnostics: diagnostics as CanvasDiagnostic[] }
        : null;
    case 'unavailable':
      if (typeof text !== 'string') return null;
      if (!UNAVAILABLE_REASONS.includes(reason as CompilerUnavailableReason)) return null;
      return { requestId, status, reason: reason as CompilerUnavailableReason, message: text };
    default:
      return null;
  }
}

function editResponse(
  requestId: number,
  { status, files, landed, code, message }: Record<string, unknown>,
): Extract<CompilerResponse, { status: 'edited' | 'edit_failed' }> | null | undefined {
  if (status === 'edited') {
    const parsedFiles = sourceFilesSchema.safeParse(files);
    const parsedLanded = outlineNodeIdSchema.nullable().safeParse(landed);
    if (!parsedFiles.success || !parsedLanded.success) return null;
    return { requestId, status, files: parsedFiles.data, landed: parsedLanded.data };
  }
  if (status === 'edit_failed')
    return typeof message === 'string' && EDIT_FAILURE_CODES.includes(code as EditFailureCode)
      ? { requestId, status, code: code as EditFailureCode, message }
      : null;
  return undefined;
}

/** The answer to a read of source rather than a build: its modules, or a catalog's failures. */
function readResponse(
  requestId: number,
  { status, modules, failures }: Record<string, unknown>,
): Extract<CompilerResponse, { status: 'modules' | 'catalogChecked' }> | null | undefined {
  if (status === 'catalogChecked') {
    const parsed = kitFailureSchema.array().safeParse(failures);
    return parsed.success ? { requestId, status, failures: parsed.data } : null;
  }
  if (status !== 'modules') return undefined;
  const parsed = moduleDeclarationsSchema.array().safeParse(modules);
  return parsed.success ? { requestId, status: 'modules', modules: parsed.data } : null;
}

function isCompiledDesign(design: unknown): design is CompiledDesign {
  if (typeof design !== 'object' || design === null) return false;
  const { artifactId, html, diagnostics, elements, outline } = design as Record<string, unknown>;
  return (
    typeof artifactId === 'string' &&
    typeof html === 'string' &&
    Array.isArray(diagnostics) &&
    Array.isArray(elements) &&
    elements.length <= CANVAS_LIMITS.maxSourceElements &&
    elements.every((element) => sourceElementSchema.safeParse(element).success) &&
    sourceOutlineSchema.safeParse(outline).success
  );
}
