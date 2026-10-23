export interface Crumb {
  label: string;
  path: string;
  isHome: boolean;
}

function separatorOf(path: string): '/' | '\\' {
  return path.includes('\\') && !path.includes('/') ? '\\' : '/';
}

export function joinPath(parent: string, name: string): string {
  const separator = separatorOf(parent);
  return parent.endsWith(separator) ? `${parent}${name}` : `${parent}${separator}${name}`;
}

export function baseName(path: string): string {
  const parts = path.split(separatorOf(path)).filter(Boolean);
  return parts.at(-1) ?? path;
}

/** The path as clickable segments, starting at the laptop's home folder when it is inside it. */
export function breadcrumb(path: string, home: string | null): Crumb[] {
  const separator = separatorOf(path);
  let root: Crumb;
  let rest: string;
  if (home && (path === home || path.startsWith(`${home}${separator}`))) {
    root = { label: baseName(home), path: home, isHome: true };
    rest = path.slice(home.length);
  } else if (separator === '/') {
    root = { label: '/', path: '/', isHome: false };
    rest = path;
  } else {
    const drive = path.slice(0, path.indexOf(separator) + 1) || path;
    root = { label: drive.replace(/\\$/, ''), path: drive, isHome: false };
    rest = path.slice(drive.length);
  }
  const crumbs = [root];
  let current = root.path;
  for (const name of rest.split(separator).filter(Boolean)) {
    current = joinPath(current, name);
    crumbs.push({ label: name, path: current, isHome: false });
  }
  return crumbs;
}

export interface ListingProblem {
  title: string;
  detail: string;
  // A connection problem can succeed on retry; the others need a different folder.
  retryable: boolean;
}

/** Turns a failed laptop folder listing into words a person can act on. */
export function describeListingError(message: string): ListingProblem {
  if (/EACCES|EPERM|permission|not permitted/i.test(message))
    return {
      title: 'DROIDEX can’t read this folder',
      detail:
        'Your laptop blocked access. On a Mac, allow DROIDEX in System Settings → Privacy & Security → Files and Folders.',
      retryable: false,
    };
  if (/ENOENT|no such file/i.test(message))
    return {
      title: 'This folder no longer exists',
      detail: 'It may have been moved or deleted on your laptop.',
      retryable: false,
    };
  if (/ENOTDIR|not a directory/i.test(message))
    return { title: 'That isn’t a folder', detail: 'Choose a folder instead.', retryable: false };
  if (/not connected|disconnected|did not answer|unlock this browser|signed out/i.test(message))
    return {
      title: 'Lost the connection to your laptop',
      detail: 'Wait a moment for DROIDEX to reconnect, then try again.',
      retryable: true,
    };
  return { title: 'Couldn’t open this folder', detail: message, retryable: true };
}
