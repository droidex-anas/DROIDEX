// Tailwind 3 internals with no published types: the context its class list
// and rules come from, the rules it generates for a class, and the rule that
// names a utility's class for a theme key. Node cannot see their named
// exports, so each is imported whole.

declare module 'tailwindcss/lib/lib/setupContextUtils' {
  /** Opaque to callers; generateRules reads and caches into it. */
  export interface TailwindContext {
    getClassList(): string[];
  }
  const setupContextUtils: {
    createContext(config: unknown): TailwindContext;
  };
  export default setupContextUtils;
}

declare module 'tailwindcss/lib/lib/generateRules' {
  import type { TailwindContext } from 'tailwindcss/lib/lib/setupContextUtils';
  interface GeneratedRule {
    walkDecls(callback: (declaration: { prop: string }) => void): void;
  }
  const generateRules: {
    generateRules(candidates: Set<string>, context: TailwindContext): [unknown, GeneratedRule][];
  };
  export default generateRules;
}

declare module 'tailwindcss/lib/util/nameClass' {
  const nameClass: { formatClass(utility: string, key: string): string };
  export default nameClass;
}
