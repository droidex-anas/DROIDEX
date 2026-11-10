// What the compiler process answers a module read with (moduleDeclarations.ts
// reads it there), checked here as it crosses back into the sidecar.

import { z } from 'zod';

const moduleSpecifierSchema = z.object({
  text: z.string(),
  /** Where the text between its quotes is in the source. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  /** False for a type-only import or re-export, which the build erases. */
  loads: z.boolean(),
});

/** A value a module exports; a default export by the name it declares, if any. */
const moduleExportSchema = z.union([
  z.object({ isDefault: z.literal(false), name: z.string() }),
  z.object({ isDefault: z.literal(true), name: z.string().nullable() }),
]);

/** An import declaration, so it can be rewritten whole. */
const moduleImportSchema = z.object({
  specifier: z.string(),
  /** Where the declaration is in the source, with its semicolon. */
  start: z.number().int().nonnegative(),
  end: z.number().int().nonnegative(),
  /** The values it imports by name; null when it binds anything else, or nothing. */
  names: z.array(z.object({ imported: z.string(), local: z.string() })).nullable(),
});

/** Every module specifier a source names, in source order, its imports, and what it exports. */
export const moduleDeclarationsSchema = z.object({
  specifiers: z.array(moduleSpecifierSchema),
  imports: z.array(moduleImportSchema),
  exports: z.array(moduleExportSchema),
});

export type ModuleSpecifier = z.infer<typeof moduleSpecifierSchema>;
export type ModuleImport = z.infer<typeof moduleImportSchema>;
export type ModuleExport = z.infer<typeof moduleExportSchema>;
export type ModuleDeclarations = z.infer<typeof moduleDeclarationsSchema>;
