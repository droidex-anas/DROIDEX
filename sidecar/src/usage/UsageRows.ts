export function rowNumber(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Usage database value ${key} is corrupt.`);
  }
  return value;
}

export function nullableRowNumber(
  row: Record<string, unknown> | undefined,
  key: string,
): number | null {
  if (row?.[key] === null) return null;
  return rowNumber(row, key);
}

export function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Usage database value ${key} is corrupt.`);
  return value;
}

export function nullableRowString(row: Record<string, unknown>, key: string): string | null {
  if (row[key] === null) return null;
  return rowString(row, key);
}

export function rowBlob(row: Record<string, unknown>, key: string, bytes: number): Uint8Array {
  const value = row[key];
  if (!(value instanceof Uint8Array) || value.byteLength !== bytes) {
    throw new Error(`Usage database value ${key} is corrupt.`);
  }
  return value;
}
