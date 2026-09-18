// Which inline code in a model's prose names a file the Review panel can open.
// "See `src/components/ChatView.tsx:42`" should be reachable; `npm ci`,
// `useState`, and `either/or` should stay plain text, so the shape has to be
// unmistakably a path rather than merely plausible.

// A mention may end in the line it is about (and editors often add the column);
// Review opens whole files, so the suffix is trimmed off the path.
const LINE_SUFFIX = /:\d+(?::\d+)?$/;

// Whitespace other than a plain space, plus shell and code punctuation: a
// command, a call, or a glob. A plain space is judged by where it falls, and a
// backslash is turned into a separator before this runs.
const NOT_A_PATH_CHAR = /[^\S ]|[*?"'`<>|(){}[\],;=$!]/;

// The one colon a path may carry.
const DRIVE_LETTER = /^[a-z]:/i;

const FILE_EXTENSION =
  /\.(?:tsx?|jsx?|mjs|cjs|json|jsonc|css|scss|html|md|mdx|txt|ya?ml|toml|ini|cfg|env|sql|sh|bash|zsh|py|rb|go|rs|java|kt|swift|c|h|cc|cpp|cs|php|lock)$/i;

// Repo files whose whole name identifies them, so no extension can. Mirrors the
// extensionless names in ./filePreview, which belongs to the lazily loaded Files
// pane and must not be pulled into the transcript's bundle. "profile" is left
// out on purpose: as inline code it reads as the word, not the file. The dotted
// names are listed apart because without their dot they are ordinary words:
// "gitignore" in a sentence is prose, ".gitignore" is a file.
const WHOLE_NAME_FILES = new Set(['dockerfile', 'makefile', 'rakefile', 'gemfile', 'procfile']);

const DOTFILE_NAMES = new Set([
  'babelrc',
  'eslintrc',
  'prettierrc',
  'gitignore',
  'gitattributes',
  'npmrc',
  'yarnrc',
  'nvmrc',
  'bashrc',
  'zshrc',
]);

function namesWholeNameFile(name: string): boolean {
  const lower = name.toLowerCase();
  if (WHOLE_NAME_FILES.has(lower)) return true;
  return lower.startsWith('.') && DOTFILE_NAMES.has(lower.slice(1));
}

// Inline code that cannot be a path at all: a command, a call, a glob, a URL or
// a command-line flag.
function couldBeAPath(mention: string): boolean {
  if (!mention || NOT_A_PATH_CHAR.test(mention)) return false;
  return !mention.includes('://') && !mention.startsWith('-');
}

// A space belongs inside a file name, never to the directories above it, and
// only a directory in front vouches for it: `src/My Component.tsx` is a path,
// while `see README.md` and `npm ci` stay prose.
function spaceSitsInsideTheFileName(segments: string[]): boolean {
  if (segments.length < 2) return !segments[0]?.includes(' ');
  return segments.slice(0, -1).every((directory) => !directory.includes(' '));
}

/**
 * The file path an inline-code mention names, or null when it names something
 * else. A path either ends in a known file name or extension, or is relative and
 * nests at least two directories deep, which keeps prose pairs like
 * `client/server`, bare directories and system binaries like `/usr/bin/node`
 * (nothing for Review to show) out of the clickable set.
 */
export function repoPathInProse(text: string): string | null {
  // A Windows mention names the same file; Review compares normalized paths.
  const mention = text.trim().replaceAll('\\', '/');
  if (!couldBeAPath(mention)) return null;
  const path = mention.replace(LINE_SUFFIX, '');
  const drive = DRIVE_LETTER.exec(path)?.[0] ?? '';
  const body = path.slice(drive.length);
  if (!body || body.endsWith('/') || body.includes(':')) return null;
  const segments = body.split('/');
  if (!spaceSitsInsideTheFileName(segments)) return null;
  const name = segments.at(-1) ?? '';
  if (FILE_EXTENSION.test(name) || namesWholeNameFile(name)) return path;
  const absolute = drive !== '' || body.startsWith('/');
  // The depth fallback has no extension to lean on, so a space in the last
  // segment means prose ("src/lib/index.ts is stale"), not a file name.
  return !absolute && segments.length > 2 && !name.includes(' ') ? path : null;
}
