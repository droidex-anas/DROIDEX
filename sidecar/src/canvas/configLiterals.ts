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
export interface ConfigEntry {
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

// The reader recurses once per object or array, so deeper input is refused first.
const MAX_NESTING = 32;

/** The object a `theme:` property holds, wherever the config declares it. */
export function readConfigTheme(
  source: string,
): { status: 'read'; theme: ConfigValue | null } | { status: 'tooDeep' } {
  const tokens = tokenize(source);
  if (nesting(tokens) > MAX_NESTING) return { status: 'tooDeep' };
  for (let index = 0; index + 2 < tokens.length; index += 1) {
    const [key, colon, open] = tokens.slice(index, index + 3);
    if (key.kind !== 'punct' && key.text === 'theme' && colon.text === ':' && open.text === '{')
      return { status: 'read', theme: new LiteralReader(tokens, index + 2).value() };
  }
  return { status: 'read', theme: null };
}

function nesting(tokens: Token[]): number {
  let depth = 0;
  let deepest = 0;
  for (const { kind, text } of tokens) {
    if (kind !== 'punct') continue;
    if (text === '{' || text === '[' || text === '(') {
      depth += 1;
      deepest = Math.max(deepest, depth);
    } else if ((text === '}' || text === ']' || text === ')') && depth > 0) depth -= 1;
  }
  return deepest;
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
  constructor(
    private readonly tokens: Token[],
    private index: number,
  ) {}

  value(): ConfigValue {
    const token = this.tokens.at(this.index);
    if (!token) return { kind: 'computed', line: this.tokens.at(-1)?.line ?? 1 };
    if (this.at('{')) return this.object();
    if (this.at('[')) return this.list();
    if (token.kind === 'text' && this.endsValue(this.index + 1)) {
      this.index += 1;
      return { kind: 'text', value: token.text, line: token.line };
    }
    this.skipExpression();
    return { kind: 'computed', line: token.line };
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

  private at(text: string): boolean {
    const token = this.tokens.at(this.index);
    return token?.kind === 'punct' && token.text === text;
  }
}
