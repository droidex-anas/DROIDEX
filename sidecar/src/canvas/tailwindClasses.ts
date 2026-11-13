// How the design checks read a Tailwind class written in source: the utility
// under its variants, and the prefix and value of an arbitrary one.

const ARBITRARY_CLASS = /^-?([a-z][\w-]*?)-\[(.+)\](?:\/\S+)?$/;

/** `hover:data-[state=open]:bg-red-500` is `bg-red-500`; a colon inside brackets is part of it. */
export function withoutVariants(token: string): string {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index += 1) {
    const character = token[index];
    if (character === '[') depth += 1;
    else if (character === ']') depth -= 1;
    else if (character === ':' && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!/, '');
}

/**
 * The prefix and CSS value of a `prefix-[value]` utility, with underscores read
 * as spaces and a type hint such as `color:` dropped; null for any other class.
 */
export function arbitraryUtility(utility: string): { prefix: string; value: string } | null {
  const match = ARBITRARY_CLASS.exec(utility);
  if (!match) return null;
  const value = match[2].replace(/_/g, ' ').replace(/^[a-z-]+:(?!\/)/, '');
  return { prefix: match[1], value };
}
