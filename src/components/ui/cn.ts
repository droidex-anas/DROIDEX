// Joins class names, skipping falsy entries. Named `cn` so the design-token
// lint rule checks every string passed through it.
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}
