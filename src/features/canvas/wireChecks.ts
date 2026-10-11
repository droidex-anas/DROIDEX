// The JSON shape checks every Canvas wire validator shares. Their bounds mirror
// the sidecar's schema; nothing here knows a Canvas DTO.

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function list(value: unknown, entry: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(entry);
}

export function boundedList(
  value: unknown,
  max: number,
  entry: (item: unknown) => boolean,
): boolean {
  return Array.isArray(value) && value.length <= max && value.every(entry);
}

/** An opaque Canvas identifier, bounded the way the sidecar schema bounds it. */
export function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

export function text(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_000;
}

export function boundedText(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

export function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** A chat identifier, bounded the way the sidecar schema bounds it. */
export function isAppSessionId(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}

export function isRect(value: unknown): boolean {
  return (
    record(value) &&
    finite(value.x) &&
    finite(value.y) &&
    finite(value.width) &&
    finite(value.height)
  );
}
