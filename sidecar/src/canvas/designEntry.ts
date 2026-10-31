// Whether a source tree can be a design at all: it has `main.tsx` and no HTML
// page standing in for it. A write that breaks this is refused while the
// agent's tool call is still open, so it fixes the tree in the same turn; the
// compiler checks again, and the bundler reports a missing default export.

import type { CanvasDiagnostic } from './protocol.js';

/** The file a design's component is compiled from. */
export const DESIGN_ENTRY = 'main.tsx';

const MISSING_ENTRY = `A design needs ${DESIGN_ENTRY}, which default-exports its component.`;

/** Why these paths cannot be a design, or null when they can. */
export function designEntryDiagnostic(paths: readonly string[]): CanvasDiagnostic | null {
  const page = paths.find((path) => path.endsWith('.html'));
  if (page !== undefined)
    return {
      code: 'compile_failed',
      message: `${page} is not compiled. A design is ${DESIGN_ENTRY}, which default-exports a React component; write the page as that component's JSX and put ${page} in deletedPaths.`,
      file: page,
    };
  if (paths.includes(DESIGN_ENTRY)) return null;
  if (paths.length === 0) return { code: 'missing_module', message: MISSING_ENTRY };
  return {
    code: 'missing_module',
    message: `${MISSING_ENTRY} This design has ${listed(paths)}. Send the entry component as ${DESIGN_ENTRY}, and put a misnamed entry in deletedPaths.`,
  };
}

function listed(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).join(', ');
  return paths.length > 3 ? `${shown} and ${String(paths.length - 3)} more` : shown;
}
