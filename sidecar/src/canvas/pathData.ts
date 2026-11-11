// Path data as an SVG `<path d>` spells it (SVG 2, the path data grammar),
// with only spaces and commas between its parts. That is how the board writes
// a path back, and it leaves no room for a control character or markup.
//
// The renderer (src/features/canvas/paths/pathData.ts) and the preview
// (electron/canvasPreviewSvg.cjs) read path data by the same rule; this
// module's test holds the three to one set of cases.

/** Characters a path edit's `d` may measure: twice what the preview reads, as writing it back may lengthen it. */
export const MAX_PATH_DATA_LENGTH = 32 * 1024;

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
const SPACES = / */y;
const SEPARATOR = / *,? */y;
const NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?/y;
// An arc's large-arc and sweep flags are one digit each, which may touch what follows.
const FLAG = /[01]/y;
// Chromium reads a path's numbers as floats, and refuses one past this or a larger exponent.
const MAX_NUMBER = 1e38;
const MAX_EXPONENT = 38;

/** Whether `d` is whole path data: a moveto first, then commands each followed by whole segments. */
export function isPathData(d: string): boolean {
  if (d.length > MAX_PATH_DATA_LENGTH) return false;
  const reader = { d, at: 0 };
  read(reader, SPACES);
  if (d.charAt(reader.at).toUpperCase() !== 'M') return false;
  while (reader.at < d.length) {
    const command = d.charAt(reader.at).toUpperCase();
    reader.at += 1;
    read(reader, SPACES);
    if (!readSegments(reader, command)) return false;
  }
  return true;
}

interface Reader {
  d: string;
  at: number;
}

function read(reader: Reader, pattern: RegExp): RegExpExecArray | null {
  pattern.lastIndex = reader.at;
  const found = pattern.exec(reader.d);
  if (found) reader.at = pattern.lastIndex;
  return found;
}

/** Reads a command's segments, one or more until the next command or the end; Z has none. */
function readSegments(reader: Reader, command: string): boolean {
  const count = COMMAND_NUMBERS.get(command);
  if (count === undefined) return false;
  if (count === 0) return true;
  let comma = false;
  do {
    for (let index = 0; index < count; index += 1) {
      const isFlag = command === 'A' && (index === 3 || index === 4);
      const found = read(reader, isFlag ? FLAG : NUMBER);
      if (!found || (!isFlag && !isInRange(found[0], found[1]))) return false;
      comma = read(reader, SEPARATOR)?.[0].includes(',') ?? false;
    }
    // A comma promises another segment; anything but a command or the end is one.
  } while (comma || (reader.at < reader.d.length && !isCommand(reader.d.charAt(reader.at))));
  return true;
}

function isInRange(number: string, exponent: string | undefined): boolean {
  return Math.abs(Number(number)) <= MAX_NUMBER && Number(exponent ?? 0) <= MAX_EXPONENT;
}

function isCommand(character: string): boolean {
  return COMMAND_NUMBERS.has(character.toUpperCase());
}
