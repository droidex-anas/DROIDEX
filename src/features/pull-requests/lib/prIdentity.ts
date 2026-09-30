// GitHub identity presentation for the PR workspace.
//
// GitHub serves an avatar for any login — users and `<app>[bot]` apps alike —
// from avatars.githubusercontent.com, so the workspace shows the same faces the
// user sees on github.com without a second API round trip per author. Unknown
// logins get GitHub's own placeholder image, and a failed request falls back to
// initials in the component.

const AVATAR_HOST = 'https://avatars.githubusercontent.com';

// gh reports a missing author as this literal, so it must never become a URL.
const UNKNOWN_LOGIN = 'unknown';

function normalizeLogin(login: string | null | undefined): string | null {
  const trimmed = (login ?? '').trim();
  if (!trimmed || trimmed.toLowerCase() === UNKNOWN_LOGIN) return null;
  return trimmed;
}

export function githubAvatarUrl(login: string | null | undefined, size: number): string | null {
  const normalized = normalizeLogin(login);
  if (!normalized) return null;
  // Ask for 2x so the image stays crisp on retina displays.
  return `${AVATAR_HOST}/${encodeURIComponent(normalized)}?size=${String(Math.round(size * 2))}`;
}

// `cubic-dev-ai[bot]` reads as `cubic-dev-ai` on github.com; keep the raw login
// for the avatar URL and show the trimmed name.
export function displayLogin(login: string | null | undefined): string {
  const normalized = normalizeLogin(login);
  if (!normalized) return 'unknown';
  return normalized.replace(/\[bot\]$/i, '');
}

export function authorInitials(login: string | null | undefined): string {
  const name = displayLogin(login);
  const words = name.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1 ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}` : name.slice(0, 2);
  return (letters || '?').toUpperCase();
}
