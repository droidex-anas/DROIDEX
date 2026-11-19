export function lookupChild<T>(
  entries: Readonly<Partial<Record<string, Readonly<Partial<Record<string, T>>>>>>,
  parentId: string,
  childId: string,
): T | undefined {
  return entries[parentId]?.[childId];
}
