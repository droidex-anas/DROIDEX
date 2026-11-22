import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import type { CanvasDiagnostic, SourceFiles } from '@droidex/protocol';

interface TokenReference {
  token: string;
  file: string;
  line: number;
}

export type TokenScope = 'shared' | 'light' | 'dark';

interface SourceTokens {
  modes: Record<'light' | 'dark', Set<string>>;
  references: TokenReference[];
  diagnostics: CanvasDiagnostic[];
  localTokens: Set<string>;
}

/** Only global declarations with an explicit mode (or an explicit shared value) become kit tokens. */
function sourceTokens(files: SourceFiles): SourceTokens {
  const result: SourceTokens = {
    modes: { light: new Set(), dark: new Set() },
    references: [],
    diagnostics: [],
    localTokens: new Set(),
  };
  for (const [file, content] of Object.entries(files)) {
    if (!/\.(?:css|[jt]sx?)$/.test(file)) continue;
    if (!file.endsWith('.css')) {
      const text = content.replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`/g,
        (part) => (part.startsWith('/') ? part.replace(/[^\n]/g, ' ') : part),
      );
      let referenceLine = 1;
      let lastReference = 0;
      for (const match of text.matchAll(/\bvar\(\s*(--[^\s,)]+)\s*[,)]/g)) {
        referenceLine += text.slice(lastReference, match.index).split('\n').length - 1;
        lastReference = match.index;
        result.references.push({ token: match[1], file, line: referenceLine });
      }
      for (const match of text.matchAll(/(['"])(--[^'"\s]+)\1\s*:/g)) {
        result.localTokens.add(match[2]);
      }
      continue;
    }
    let root;
    try {
      root = postcss.parse(content, { from: undefined, map: false });
    } catch {
      result.diagnostics.push({
        code: 'css_error',
        message: 'Fix this stylesheet before mapping its tokens.',
        file,
      });
      continue;
    }
    root.walkDecls((declaration) => {
      let valueLine =
        (declaration.source?.start?.line ?? 1) +
        (declaration.raws.between ?? '').split('\n').length -
        1;
      let lastReference = 0;
      valueParser(declaration.value).walk((node) => {
        if (node.type !== 'function' || node.value.toLowerCase() !== 'var') return;
        const token = node.nodes.find((part) => part.type === 'word')?.value;
        if (!token?.startsWith('--')) return;
        valueLine +=
          declaration.value.slice(lastReference, node.sourceIndex).split('\n').length - 1;
        lastReference = node.sourceIndex;
        result.references.push({ token, file, line: valueLine });
      });
      if (!declaration.prop.startsWith('--')) return;
      const rule = declaration.parent;
      const modes =
        rule?.type === 'rule' && rule.parent?.type === 'root'
          ? selectorScopes(rule.selector, rootSelectorScope)
          : [];
      if (modes.length === 0) {
        result.localTokens.add(declaration.prop);
        return;
      }
      for (const mode of modes) {
        if (mode === 'shared') {
          result.modes.light.add(declaration.prop);
          result.modes.dark.add(declaration.prop);
        } else result.modes[mode].add(declaration.prop);
      }
    });
  }
  return result;
}

/** The kit scope one selector names: `:root` or `html` is shared, and a root `data-mode` rule is that mode. */
export function rootSelectorScope(selector: string): TokenScope | null {
  if (selector === ':root' || selector === 'html') return 'shared';
  const match = /^(?::root|html)?\[data-mode\s*=\s*['"]?(light|dark)['"]?\]$/.exec(selector);
  if (!match) return null;
  return match[1] === 'light' ? 'light' : 'dark';
}

/** Every scope a rule's selector list names, or none when any selector names another rule. */
export function selectorScopes(
  selectors: string,
  scopeOf: (selector: string) => TokenScope | null,
): TokenScope[] {
  const scopes = new Set<TokenScope>();
  for (const selector of selectors.split(',')) {
    const scope = scopeOf(selector.trim());
    if (scope === null) return [];
    scopes.add(scope);
  }
  return [...scopes];
}

/** A value as a scope keeps it: hex shorthand is expanded, so `#abc` and `#aabbcc` agree. */
export function scopeValue(value: string): string {
  return value.replace(
    /^#([\da-f]{3,4})$/i,
    (_match, hex: string) =>
      '#' + hex.replace(/[\da-f]/gi, (digit) => digit.repeat(2)).toLowerCase(),
  );
}

/**
 * Records one custom property in each scope it applies to, as `scopeValue`
 * spells it; a different value in a scope that already has one is reported as
 * competing, and callers refuse it.
 */
export function declareToken(
  scopes: Record<TokenScope, Record<string, string>>,
  token: { name: string; value: string; targets: TokenScope[]; file?: string; line?: number },
  diagnostics: CanvasDiagnostic[],
): void {
  const { name, targets, file, line } = token;
  const value = scopeValue(token.value);
  for (const scope of targets) {
    const tokens = scopes[scope];
    if (Object.hasOwn(tokens, name) && tokens[name] !== value)
      diagnostics.push({
        code: 'ambiguous_token',
        message: `${name} has competing ${scope} values. Choose one explicitly.`,
        file,
        line,
      });
    tokens[name] = value;
  }
}

/** One actionable location per missing token; kit values never fill in source-owned values. */
export function unmappedTokens(
  files: SourceFiles,
  tokens: Record<string, string>,
  mode: 'light' | 'dark',
): CanvasDiagnostic[] {
  const source = sourceTokens(files);
  const reported = new Set<string>();
  const diagnostics = source.references.flatMap(({ token, file, line }) => {
    if (
      Object.hasOwn(tokens, token) ||
      source.modes[mode].has(token) ||
      source.localTokens.has(token) ||
      reported.has(token)
    )
      return [];
    reported.add(token);
    return [
      {
        code: 'unmapped_token',
        message: `${token} is not defined by the target kit. Add a source-owned value or choose a kit that defines it.`,
        file,
        line,
      },
    ];
  });
  return [...source.diagnostics, ...diagnostics];
}
