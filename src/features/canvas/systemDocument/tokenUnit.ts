// A token value that is one number and a unit, such as 12px or 150ms, shows
// and edits as the number with the unit as a quiet suffix.

const WITH_UNIT = /^(-?\d*\.?\d+)(px|rem|em|ms|s|%)$/;
const BARE_NUMBER = /^-?\d*\.?\d+$/;

export interface UnitValue {
  number: string;
  unit: string;
}

export function splitUnit(value: string): UnitValue | null {
  const match = WITH_UNIT.exec(value);
  return match ? { number: match[1], unit: match[2] } : null;
}

/** The value an edit of the number makes: a bare number keeps the unit, anything else stands as typed. */
export function withUnit(text: string, unit: string): string {
  return BARE_NUMBER.test(text) ? `${text}${unit}` : text;
}
