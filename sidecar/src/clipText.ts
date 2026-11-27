export function clip(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  const clipped = value.slice(0, maximum);
  // Slicing by code unit can cut an emoji or other astral character in half.
  const last = clipped.charCodeAt(clipped.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? clipped.slice(0, -1) : clipped;
}
