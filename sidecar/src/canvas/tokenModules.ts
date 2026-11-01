// Reads a JS, TS or JSON token module, pasted or read from a project, into
// declared tokens. Nothing here runs the module: its bindings are read for
// their literals only.

import { readConfigBindings, type ConfigValue } from './configLiterals.js';
import {
  declare,
  fileOf,
  placeIn,
  tokenName,
  type Declared,
  type Mode,
  type TextOrigin,
} from './designSystemSources.js';
import { scopeValue } from './designSystemTokens.js';
import type { CanvasDiagnostic } from './protocol.js';

// Keys a token module carries beside its values; they never name a token.
const MODULE_METADATA = new Set([
  'name',
  'id',
  'version',
  'usage',
  'description',
  '$description',
  'comment',
  'type',
  '$type',
  'meta',
  'note',
]);

/** A binding or entry named for a mode holds that mode's values. */
function bindingMode(name: string | null): Mode | null {
  if (name === null) return null;
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/);
  if (words.includes('light')) return 'light';
  if (words.includes('dark')) return 'dark';
  return null;
}

/**
 * Reads a JS, TS or JSON token module's literal bindings, never running them:
 * nested objects flatten into hyphenated names, `light` and `dark` entries
 * set that mode's value, a `value` entry unwraps, and a list of named records
 * (a token file's `{ name, value }` entries) names each token by its record.
 * A flattened name another value already holds widens by its family, reported
 * as renamed, and is refused when it cannot; what cannot be read is reported,
 * never dropped quietly.
 */
export function readTokenModule(
  text: string,
  origin: TextOrigin,
  declared: Declared,
  diagnostics: CanvasDiagnostic[],
): CanvasDiagnostic | null {
  const read = readConfigBindings(text);
  if (read.status === 'tooDeep')
    return {
      code: 'invalid_input',
      message: 'That token module nests its values too deeply to read.',
      ...fileOf(origin),
    };
  const diagnosed = diagnostics.length;
  let found = 0;
  /** The kit name each source token took, by its family and name, so all its values land there. */
  const kitNames = new Map<string, string>();
  /** Each kit name this module took, by the source token that took it and the first value it set. */
  const claims = new Map<string, { owner: string; value: string }>();
  const leaf = (
    value: ConfigValue,
    name: string,
    path: string,
    mode: Mode | null,
    family: string,
  ): void => {
    const place = placeIn(origin, value.line);
    if (value.kind !== 'text') {
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${path} is computed in the module. Set it with a token change instead.`,
        ...place,
      });
      return;
    }
    const owner = `${family}\n${name}`;
    let token = kitNames.get(owner) ?? null;
    if (token === null) {
      token = tokenName(name);
      if (token === null) return;
      // A name another value already holds (a size next to a colour) widens by
      // its family; with no honest name, the competing values are refused. A
      // mode's value over another source's shared one is the cascade's override.
      const stored = scopeValue(value.value.replace(/\s+/g, ' ').trim());
      const taken = (candidate: string): boolean => {
        const shared = declared.scopes.shared[candidate] as string | undefined;
        if (mode === null && shared !== undefined && shared !== stored) return true;
        const claim = claims.get(candidate);
        return claim !== undefined && claim.owner !== owner && claim.value !== stored;
      };
      if (taken(token)) {
        const widened =
          family !== '' && name !== family && !name.startsWith(`${family}-`)
            ? tokenName(`${family}-${name}`)
            : null;
        if (widened === null || widened === token || taken(widened)) {
          diagnostics.push({
            code: 'ambiguous_token',
            message: `${path} and another value both name ${token}. Choose one explicitly.`,
            ...place,
          });
          return;
        }
        diagnostics.push({
          code: 'renamed_token',
          message: `${path} is ${widened} in the kit: ${token} already names another value.`,
          ...place,
        });
        token = widened;
      }
      kitNames.set(owner, token);
      if (!claims.has(token)) claims.set(token, { owner, value: stored });
    }
    declare(
      declared,
      { name: token, value: value.value, targets: mode === null ? ['shared'] : [mode], place },
      diagnostics,
    );
    found += 1;
  };
  const collect = (
    value: ConfigValue,
    name: string,
    path: string,
    mode: Mode | null,
    family: string,
  ): void => {
    if (value.kind === 'object') {
      for (const entry of value.entries) {
        if (entry.key === null) {
          leaf(entry.value, name, path, mode, family);
          continue;
        }
        const key = entry.key;
        if (key === 'light' || key === 'dark') {
          if (entry.value.kind === 'object')
            collect(entry.value, name, `${path}.${key}`, key, family);
          else leaf(entry.value, name || key, `${path}.${key}`, key, family);
          continue;
        }
        if (key === 'value' || key === '$value' || key === 'DEFAULT') {
          if (entry.value.kind === 'object')
            collect(entry.value, name, `${path}.${key}`, mode, family);
          else leaf(entry.value, name || key, `${path}.${key}`, mode, family);
          continue;
        }
        if (MODULE_METADATA.has(key)) continue;
        collect(
          entry.value,
          name === '' ? key : `${name}-${key}`,
          `${path}.${key}`,
          mode,
          family === '' ? key : family,
        );
      }
      return;
    }
    if (value.kind === 'list') {
      if (value.items.length === 0) return;
      const records = value.items.flatMap((item) => {
        const recordName = tokenRecordName(item);
        return recordName === null ? [] : [{ item, name: recordName }];
      });
      // A record names its token itself; the path it sits under is no prefix,
      // only its family's fallback when the name is taken.
      if (records.length === value.items.length) {
        const section = name.replace(/(?:^|-)tokens$/, '') || family;
        for (const record of records)
          collect(record.item, record.name, `${path}.${record.name}`, mode, section);
        return;
      }
      const texts = value.items.flatMap((item) => (item.kind === 'text' ? [item.value] : []));
      // A family list and a layered shadow both join.
      if (texts.length === value.items.length) {
        leaf({ kind: 'text', value: texts.join(', '), line: value.line }, name, path, mode, family);
        return;
      }
      diagnostics.push({
        code: 'manual_interpretation_required',
        message: `${path} is a list of values the import cannot read. Set them with token changes instead.`,
        ...placeIn(origin, value.line),
      });
      return;
    }
    leaf(value, name, path, mode, family);
  };
  for (const binding of read.bindings) {
    const fragment = binding.name === null ? '' : (tokenName(binding.name)?.slice(2) ?? '');
    collect(
      binding.value,
      fragment,
      binding.name ?? 'the module',
      bindingMode(binding.name),
      fragment,
    );
  }
  if (found === 0 && diagnostics.length === diagnosed)
    diagnostics.push({
      code: 'no_tokens',
      message: 'That token module declares no literal token values.',
      ...fileOf(origin),
    });
  return null;
}

/** The token name of a `{ name, value }` record, or null for a list item that is none. */
function tokenRecordName(item: ConfigValue): string | null {
  if (item.kind !== 'object') return null;
  const name = item.entries.find((entry) => entry.key === 'name');
  const valued = item.entries.some(
    (entry) =>
      entry.key === 'value' ||
      entry.key === '$value' ||
      entry.key === 'light' ||
      entry.key === 'dark',
  );
  return valued && name?.value.kind === 'text' ? name.value.value : null;
}
