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

/**
 * A component a module exports, by the name it exports it as (`default` for
 * its default export), and the enum props of the one literal cva table its own
 * declaration uses (libraryVariants.ts).
 */
const componentVariantsSchema = z.object({
  component: z.string(),
  props: z.array(
    z.object({
      name: z.string(),
      options: z.array(z.string()),
      /** Its defaultVariants value; null when it sets none. */
      default: z.string().nullable(),
    }),
  ),
});

/** A JSX element written with a capitalised name, and its attributes: a quoted value's text, else null. */
const moduleElementSchema = z.object({
  tag: z.string(),
  attributes: z.array(z.object({ name: z.string(), value: z.string().nullable() })),
  spreads: z.boolean(),
});

/**
 * Every module specifier a source names, in source order, its imports, what
 * it exports, the variants of each component it exports and the elements it writes.
 */
export const moduleDeclarationsSchema = z.object({
  specifiers: z.array(moduleSpecifierSchema),
  imports: z.array(moduleImportSchema),
  exports: z.array(moduleExportSchema),
  variants: z.array(componentVariantsSchema),
  elements: z.array(moduleElementSchema),
});

export type ModuleSpecifier = z.infer<typeof moduleSpecifierSchema>;
export type ModuleImport = z.infer<typeof moduleImportSchema>;
export type ModuleExport = z.infer<typeof moduleExportSchema>;
export type ComponentVariants = z.infer<typeof componentVariantsSchema>;
export type ModuleElement = z.infer<typeof moduleElementSchema>;
export type ModuleDeclarations = z.infer<typeof moduleDeclarationsSchema>;
