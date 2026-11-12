// Path data as an SVG `<path d>` spells it (SVG 2, the path data grammar),
// read the way Chromium draws it, so the board never sends or previews data
// the page would not draw. The sidecar (sidecar/src/canvas/pathData.ts) and
// the preview (electron/canvasPreviewSvg.cjs) read it by the same rule;
// sidecar/src/canvas/pathData.test.ts holds the three to one set of cases.

export interface PathNumber {
  value: number;
  /** The number as written, kept so a rewrite changes only what moved. */
  text: string;
}

export interface PathSegment {
  /** The command letter as written, or as a repeat implies it. */
  command: string;
  /** Whether the letter was written, rather than implied by a repeat. */
  written: boolean;
  numbers: PathNumber[];
}

/** `board`: spaces and commas between the parts, as the board writes them; `source`: any SVG whitespace too, as a source may wrap. */
export type PathSpacing = 'board' | 'source';

/** How many numbers one segment of each command takes; Z takes none. */
const COMMAND_NUMBERS = new Map([
  ['M', 2],
  ['L', 2],
  ['H', 1],
  ['V', 1],
  ['C', 6],
  ['S', 4],
  ['Q', 4],
  ['T', 2],
  ['A', 7],
  ['Z', 0],
]);
const SPACES = { board: / */y, source: /[ \t\n\f\r]*/y };
const SEPARATOR = { board: / *(,?) */y, source: /[ \t\n\f\r]*(,?)[ \t\n\f\r]*/y };
const NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?/y;
// An arc's large-arc and sweep flags are one digit each, which may touch what follows.
const FLAG = /[01]/y;
// Chromium reads a path's numbers as floats, and refuses one past this or a larger exponent.
const MAX_NUMBER = 1e38;
const MAX_EXPONENT = 38;

interface Reader {
  d: string;
  at: number;
}

/** The path's segments in order, or null when any of `d` does not read as path data. */
export function readPathData(d: string, spacing: PathSpacing): PathSegment[] | null {
  const reader = { d, at: 0 };
  read(reader, SPACES[spacing]);
  if (upperCase(d.charAt(reader.at)) !== 'M') return null;
  const segments: PathSegment[] = [];
  while (reader.at < d.length) {
    let command = d.charAt(reader.at);
    const count = COMMAND_NUMBERS.get(upperCase(command));
    if (count === undefined) return null;
    reader.at += 1;
    read(reader, SPACES[spacing]);
    let written = true;
    let comma = false;
    do {
      const segment = readSegment(reader, command, count, spacing);
      if (!segment) return null;
      segments.push({ command, written, numbers: segment.numbers });
      ({ comma } = segment);
      written = false;
      // Pairs after a moveto are linetos, absolute or relative as it was.
      if (command === 'M') command = 'L';
      else if (command === 'm') command = 'l';
      // A comma promises another segment; anything but a command or the end is one.
    } while (count > 0 && (comma || (reader.at < d.length && !isCommand(d.charAt(reader.at)))));
  }
  return segments;
}

/** One segment's numbers, and whether a comma follows them. */
function readSegment(
  reader: Reader,
  command: string,
  count: number,
  spacing: PathSpacing,
): { numbers: PathNumber[]; comma: boolean } | null {
  const numbers: PathNumber[] = [];
  let comma = false;
  for (let index = 0; index < count; index += 1) {
    const isFlag = command.toUpperCase() === 'A' && (index === 3 || index === 4);
    const found = read(reader, isFlag ? FLAG : NUMBER);
    if (!found || (!isFlag && !isInRange(found[0], found[1]))) return null;
    numbers.push({ value: Number(found[0]), text: found[0] });
    comma = read(reader, SEPARATOR[spacing])?.[1] === ',';
  }
  return { numbers, comma };
}

function read(reader: Reader, pattern: RegExp): RegExpExecArray | null {
  pattern.lastIndex = reader.at;
  const found = pattern.exec(reader.d);
  if (found) reader.at = pattern.lastIndex;
  return found;
}

function isInRange(number: string, exponent: string | undefined): boolean {
  return Math.abs(Number(number)) <= MAX_NUMBER && Number(exponent ?? 0) <= MAX_EXPONENT;
}

function isCommand(character: string): boolean {
  return COMMAND_NUMBERS.has(upperCase(character));
}

/** Only ASCII letters are commands, and `ſ` upper-cases to S. */
function upperCase(character: string): string {
  return /^[a-z]$/.test(character) ? character.toUpperCase() : character;
}
