// The literal part of a pasted JavaScript or TypeScript config, read without
// running it: strings, numbers, arrays and nested objects. Anything else, such
// as a reference, call, spread or function, reads as `computed`, so a caller
// can name the value it could not take. A tokenizer is enough for that subset
// and keeps a full parser out of the sidecar's main process.

export type ConfigValue =
  | { kind: 'text'; value: string; line: number }
  | { kind: 'list'; items: ConfigValue[]; line: number }
  | { kind: 'object'; entries: ConfigEntry[]; line: number }
  | { kind: 'computed'; line: number };

/** A property, or a spread or computed key, which has no name to report. */
interface ConfigEntry {
  key: string | null;
  value: ConfigValue;
}

interface Token {
  kind: 'text' | 'word' | 'punct';
  text: string;
  line: number;
}

// An unclosed comment or template runs to the end, so a malformed paste stays linear.
const TOKEN =
  /\s+|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*(?:`|$)|\.\.\.|[A-Za-z_$][\w$]*|\d[\w.]*|[\s\S]/y;

// The reader recurses once per object or array it opens; past this it refuses.
const MAX_NESTING = 32;

/** A top-level binding of a module: its declared name, or null for a default export or a bare JSON object. */
export interface ConfigBinding {
  name: string | null;
  value: ConfigValue;
}

/**
 * The top-level bindings of a JavaScript or TypeScript module, or the whole
 * text as one binding when it is a bare object (a JSON file): every
 * `const name = value` (exported or not) and `export default value`, read as
 * literals. One declarator per statement; anything richer reads as computed.
 */
export function readConfigBindings(
  source: string,
): { status: 'read'; bindings: ConfigBinding[] } | { status: 'tooDeep' } {
  const tokens = tokenize(source);
  const bindings: ConfigBinding[] = [];
  let depth = 0;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token.kind === 'punct') {
      if (index === 0 && token.text === '{') {
        const read = readBindingValue(tokens, index);
        if (read.status === 'tooDeep') return read;
        bindings.push({ name: null, value: read.value });
        index = read.cursor;
        continue;
      }
      if (token.text === '{' || token.text === '[' || token.text === '(') depth += 1;
      else if (token.text === '}' || token.text === ']' || token.text === ')')
        depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (depth !== 0) {
      index += 1;
      continue;
    }
    let keyword = token.text;
    if (keyword === 'export') {
      const next = tokens.at(index + 1);
      if (next?.kind === 'word' && next.text === 'default') {
        const read = readBindingValue(tokens, index + 2);
        if (read.status === 'tooDeep') return read;
        bindings.push({ name: null, value: read.value });
        index = read.cursor;
        continue;
      }
      if (next?.kind !== 'word' || !isDeclaration(next.text)) {
        index += 1;
        continue;
      }
      keyword = next.text;
      index += 1;
    }
    if (!isDeclaration(keyword)) {
      index += 1;
      continue;
    }
    const name = tokens.at(index + 1);
    if (name?.kind !== 'word') {
      index += 1;
      continue;
    }
    const equals = bindingEquals(tokens, index + 2);
    if (equals === null) {
      index += 1;
      continue;
    }
    const read = readBindingValue(tokens, equals + 1);
    if (read.status === 'tooDeep') return read;
    bindings.push({ name: name.text, value: read.value });
    index = read.cursor;
  }
  return { status: 'read', bindings };
}

function isDeclaration(word: string): boolean {
  return word === 'const' || word === 'let' || word === 'var';
}

/** The `=` that starts the value, past a type annotation; null when the statement has none. */
function bindingEquals(tokens: Token[], start: number): number | null {
  let inner = 0;
  for (let index = start; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === 'punct') {
      // `=>` opens a function type, not a value.
      if (token.text === '=' && tokens[index + 1]?.text !== '>') return index;
      if (token.text === ';') return null;
      if (token.text === '{' || token.text === '[' || token.text === '(') inner += 1;
      else if (token.text === '}' || token.text === ']' || token.text === ')') {
        if (inner === 0) return null;
        inner -= 1;
      }
    } else if (inner === 0 && (isDeclaration(token.text) || token.text === 'export')) return null;
  }
  return null;
}

type BindingRead = { status: 'read'; value: ConfigValue; cursor: number } | { status: 'tooDeep' };

/** A binding's value: a literal, with a top-level string or number closed by `;` or `as`. */
function readBindingValue(tokens: Token[], start: number): BindingRead {
  const first = tokens.at(start);
  const after = tokens.at(start + 1);
  const closes =
    after === undefined ||
    (after.kind === 'punct' && after.text === ';') ||
    (after.kind === 'word' && after.text === 'as');
  if (first?.kind === 'text' && closes)
    return {
      status: 'read',
      value: { kind: 'text', value: first.text, line: first.line },
      cursor: start + 1,
    };
  const reader = new LiteralReader(tokens, start);
  const value = reader.value();
  if (reader.tooDeep) return { status: 'tooDeep' };
  return { status: 'read', value, cursor: reader.cursor };
}

/** The object a `theme:` property holds, wherever the config declares it. */
export function readConfigTheme(
  source: string,
): { status: 'read'; theme: ConfigValue | null } | { status: 'tooDeep' } {
  const tokens = tokenize(source);
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const [key, colon, open] = tokens.slice(index, index + 3);
    if (key.kind !== 'punct' && key.text === 'theme' && colon.text === ':' && open.text === '{') {
      const reader = new LiteralReader(tokens, index + 2);
      const theme = reader.value();
      return reader.tooDeep ? { status: 'tooDeep' } : { status: 'read', theme };
    }
  }
  return { status: 'read', theme: null };
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let line = 1;
  TOKEN.lastIndex = 0;
  for (let match = TOKEN.exec(source); match; match = TOKEN.exec(source)) {
    const [text] = match;
    const startLine = line;
    line += text.split('\n').length - 1;
    if (/^\s/.test(text) || text.startsWith('//') || text.startsWith('/*')) continue;
    const quote = text[0];
    if (quote === "'" || quote === '"' || quote === '`') {
      // A template with a substitution, or an unclosed one, is computed.
      const literal =
        text.length > 1 && text.endsWith(quote) && (quote !== '`' || !text.includes('${'));
      const value = text.slice(1, -1).replace(/\\(.)/g, '$1');
      tokens.push({ kind: literal ? 'text' : 'word', text: value, line: startLine });
    } else if (/^\d/.test(text)) tokens.push({ kind: 'text', text, line: startLine });
    else if (/^[A-Za-z_$]/.test(text)) tokens.push({ kind: 'word', text, line: startLine });
    else tokens.push({ kind: 'punct', text, line: startLine });
  }
  return tokens;
}

class LiteralReader {
  /** Set when a value opens deeper than MAX_NESTING; the caller refuses the whole read. */
  tooDeep = false;
  // What this reader has actually opened: a stray closer it steps over closes nothing.
  private depth = 0;

  constructor(
    private readonly tokens: Token[],
    private index: number,
  ) {}

  value(): ConfigValue {
    const token = this.tokens.at(this.index);
    if (!token) return { kind: 'computed', line: this.tokens.at(-1)?.line ?? 1 };
    if (this.at('{') || this.at('[')) return this.nested(token.line);
    if (token.kind === 'text' && this.endsValue(this.index + 1)) {
      this.index += 1;
      return { kind: 'text', value: token.text, line: token.line };
    }
    this.skipExpression();
    return { kind: 'computed', line: token.line };
  }

  private nested(line: number): ConfigValue {
    if (this.depth === MAX_NESTING) {
      this.tooDeep = true;
      this.skipExpression();
      return { kind: 'computed', line };
    }
    this.depth += 1;
    const value = this.at('{') ? this.object() : this.list();
    this.depth -= 1;
    return value;
  }

  private object(): ConfigValue {
    const line = this.tokens[this.index].line;
    this.index += 1;
    const entries: ConfigEntry[] = [];
    while (this.index < this.tokens.length && !this.at('}')) {
      const start = this.index;
      const key = this.tokens[start];
      if (key.kind !== 'punct' && this.tokens.at(start + 1)?.text === ':') {
        this.index += 2;
        entries.push({ key: key.text, value: this.value() });
      } else {
        this.skipExpression();
        entries.push({ key: null, value: { kind: 'computed', line: key.line } });
      }
      this.passSeparator(start);
    }
    this.index += 1;
    return { kind: 'object', entries, line };
  }

  private list(): ConfigValue {
    const line = this.tokens[this.index].line;
    this.index += 1;
    const items: ConfigValue[] = [];
    while (this.index < this.tokens.length && !this.at(']')) {
      const start = this.index;
      items.push(this.value());
      this.passSeparator(start);
    }
    this.index += 1;
    return { kind: 'list', items, line };
  }

  /** Moves to the comma or closing bracket that ends the expression at this depth. */
  private skipExpression(): void {
    let depth = 0;
    for (; this.index < this.tokens.length; this.index += 1) {
      const { kind, text } = this.tokens[this.index];
      if (kind !== 'punct') continue;
      if (text === '{' || text === '[' || text === '(') depth += 1;
      else if (text === '}' || text === ']' || text === ')') {
        if (depth === 0) return;
        depth -= 1;
      } else if (text === ',' && depth === 0) return;
    }
  }

  // A stray closing bracket in malformed input ends nothing; step over it.
  private passSeparator(start: number): void {
    if (this.at(',') || this.index === start) this.index += 1;
  }

  private endsValue(index: number): boolean {
    const next = this.tokens.at(index);
    return !next || (next.kind === 'punct' && [',', '}', ']'].includes(next.text));
  }

  /** Where the reader stopped, so a caller can keep scanning after the value. */
  get cursor(): number {
    return this.index;
  }

  private at(text: string): boolean {
    const token = this.tokens.at(this.index);
    return token?.kind === 'punct' && token.text === text;
  }
}
