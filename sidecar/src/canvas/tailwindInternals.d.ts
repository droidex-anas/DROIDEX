// Tailwind 3 internals with no published types: the context its class list
// comes from, and the rule that names a utility's class for a theme key. Node
// cannot see their named exports, so each is imported whole.

declare module 'tailwindcss/lib/lib/setupContextUtils' {
  const setupContextUtils: {
    createContext(config: unknown): { getClassList(): string[] };
  };
  export default setupContextUtils;
}

declare module 'tailwindcss/lib/util/nameClass' {
  const nameClass: { formatClass(utility: string, key: string): string };
  export default nameClass;
}
