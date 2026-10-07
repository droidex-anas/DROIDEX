import postcss, { type Declaration } from 'postcss';
import valueParser from 'postcss-value-parser';
import type { CanvasDiagnostic, SourceFiles } from './protocol.js';

export interface TokenReference {
  token: string;
  file: string;
  line: number;
}

export interface SourceTokens {
  modes: Record<'light' | 'dark', Record<string, string>>;
  references: TokenReference[];
  diagnostics: CanvasDiagnostic[];
  localTokens: Set<string>;
}

/** Only global declarations with an explicit mode (or an explicit shared value) become kit tokens. */
export function sourceTokens(files: SourceFiles): SourceTokens {
  const result: SourceTokens = {
    modes: { light: {}, dark: {} },
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
        result.diagnostics.push({
          code: 'manual_interpretation_required',
          message: `${match[2]} is an inline source override. Define its global light and dark values explicitly before extracting it as a token.`,
          file,
          line: lineAt(text, match.index),
        });
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
      const modes = declarationModes(declaration);
      if (modes.length === 0) {
        result.localTokens.add(declaration.prop);
        result.diagnostics.push({
          code: 'manual_interpretation_required',
          message: `${declaration.prop} is scoped or conditional. Define its kit values explicitly in light and dark root rules.`,
          file,
          line: declaration.source?.start?.line,
        });
        return;
      }
      for (const mode of modes) {
        const existing = result.modes[mode][declaration.prop];
        if (Object.hasOwn(result.modes[mode], declaration.prop) && existing !== declaration.value) {
          result.diagnostics.push({
            code: 'ambiguous_token',
            message: `${declaration.prop} has competing ${mode} values. Choose one explicitly before extraction.`,
            file,
            line: declaration.source?.start?.line,
          });
        }
        result.modes[mode][declaration.prop] = declaration.value;
      }
    });
  }
  return result;
}

function declarationModes(declaration: Declaration): ('light' | 'dark')[] {
  const rule = declaration.parent;
  if (rule?.type !== 'rule' || rule.parent?.type !== 'root') return [];
  const modes = new Set<'light' | 'dark'>();
  for (const selector of rule.selector.split(',').map((part) => part.trim())) {
    if (selector === ':root' || selector === 'html') {
      modes.add('light');
      modes.add('dark');
      continue;
    }
    const match = /^(?::root|html)?\[data-mode\s*=\s*['"]?(light|dark)['"]?\]$/.exec(selector);
    if (!match) return [];
    modes.add(match[1] === 'light' ? 'light' : 'dark');
  }
  return [...modes];
}

export function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
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
      Object.hasOwn(source.modes[mode], token) ||
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
  return [...source.diagnostics.filter((entry) => entry.code === 'css_error'), ...diagnostics];
}
