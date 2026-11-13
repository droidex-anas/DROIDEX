// Why the element map or a direct edit refused. Kept apart from the TypeScript
// AST code: the main sidecar names it through styleEdits.ts, and its bundle
// must not load the compiler, which only the compiler worker is built to run.

export class SourceElementError extends Error {
  constructor(
    readonly code:
      | 'stale_reference'
      | 'ambiguous_element'
      | 'invalid_source'
      | 'invalid_edit'
      | 'unsupported_edit'
      | 'selection_limit',
    message: string,
    readonly file?: string,
    readonly line?: number,
    readonly column?: number,
  ) {
    super(message);
    this.name = 'SourceElementError';
  }
}
