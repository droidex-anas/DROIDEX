export function withoutKey<T>(
  record: Partial<Record<string, T>>,
  key: string,
): Partial<Record<string, T>> {
  if (!(key in record)) return record;
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}
