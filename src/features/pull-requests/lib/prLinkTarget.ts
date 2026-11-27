// Routing of github.com pull request links into the utility pane. Pure and
// small so the click interceptor stays a one-liner and the rules are testable.

const PR_LINK = /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+)\/pull\/(\d+)(?:[/?#]|$)/i;

export interface PullRequestLink {
  // Lowercase `owner/repo`, matching repoKeyFromPrUrl's normalization.
  repoKey: string;
  number: number;
}

// `/pull/123` with any deeper path or fragment — files, commits, anchors —
// still names the same pull request.
export function parsePullRequestLink(href: string): PullRequestLink | null {
  const match = PR_LINK.exec(href.trim());
  if (!match) return null;
  const number = Number.parseInt(match[3], 10);
  if (!Number.isFinite(number) || number <= 0) return null;
  return { repoKey: `${match[1]}/${match[2]}`.toLowerCase(), number };
}

// The remote forms git produces for GitHub: scp-like ssh, https, and ssh URLs,
// each with an optional trailing `.git`.
export function gitHubRemoteRepoKey(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) return null;
  const remote = remoteUrl.trim();
  const scpLike = /^[^@/]+@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(remote);
  if (scpLike) return `${scpLike[1]}/${scpLike[2]}`.toLowerCase();
  const url =
    /^https?:\/\/(?:www\.)?github\.com\/([^/?#]+)\/([^/?#]+?)(?:\.git)?\/?(?:[?#]|$)/i.exec(remote);
  if (url) return `${url[1]}/${url[2]}`.toLowerCase();
  const ssh = /^ssh:\/\/[^@/]+@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(remote);
  if (ssh) return `${ssh[1]}/${ssh[2]}`.toLowerCase();
  return null;
}

// The pane opens only when the link names the repository the chat actually
// works in: a pane scoped to one checkout cannot show another repo's pull
// request, and guessing would open the wrong number with confidence.
export function resolvePullRequestPaneTarget(
  href: string,
  cwd: string | null | undefined,
  remoteUrl: string | null | undefined,
): { cwd: string; number: number } | null {
  if (!cwd) return null;
  const link = parsePullRequestLink(href);
  if (!link) return null;
  if (gitHubRemoteRepoKey(remoteUrl) !== link.repoKey) return null;
  return { cwd, number: link.number };
}
