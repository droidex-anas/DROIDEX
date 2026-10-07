import { CanvasCommandError } from './canvasError.js';
import type { CanvasWorkspace } from './CanvasWorkspace.js';
import { readDesignSystem } from './designSystems.js';
import { unmappedTokens } from './designSystemTokens.js';
import type { CanvasDiagnostic, CanvasScope, DesignSystemRef, WriteReceipt } from './protocol.js';

export interface ApplyDesignSystemInput {
  designId: string;
  expectedRevisionId: string | null;
  system: DesignSystemRef;
  mutationId: string;
}

export type ApplyDesignSystemResult =
  | { status: 'applied'; receipt: WriteReceipt }
  | { status: 'refused'; diagnostics: CanvasDiagnostic[] };

class TokenMappingError extends Error {
  constructor(readonly diagnostics: CanvasDiagnostic[]) {
    super('The source uses tokens the target kit does not define.');
  }
}

/** A kit apply is an ordinary source write: the workspace owns authorization, CAS and replay. */
export async function applyDesignSystem(
  workspace: CanvasWorkspace,
  scope: CanvasScope,
  input: ApplyDesignSystemInput,
): Promise<ApplyDesignSystemResult> {
  try {
    const receipt = await workspace.write(
      scope,
      {
        designId: input.designId,
        expectedRevisionId: input.expectedRevisionId,
        mutationId: input.mutationId,
        designSystem: input.system,
        files: {},
        deletedPaths: [],
      },
      async (files) => {
        const system = await readDesignSystem(input.system);
        const diagnostics = unmappedTokens(
          Object.fromEntries(files),
          system.modes[input.system.mode],
          input.system.mode,
        );
        if (diagnostics.length > 0) throw new TokenMappingError(diagnostics);
      },
    );
    return { status: 'applied', receipt };
  } catch (error) {
    if (error instanceof TokenMappingError)
      return { status: 'refused', diagnostics: error.diagnostics };
    if (error instanceof CanvasCommandError && error.code === 'version_mismatch')
      return { status: 'refused', diagnostics: [{ code: error.code, message: error.message }] };
    throw error;
  }
}
