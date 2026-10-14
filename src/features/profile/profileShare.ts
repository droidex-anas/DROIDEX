import {
  parsePublicProfileSnapshot,
  type ProfileIdentity,
  type PublicProfileSnapshot,
  type RemoteUsageSnapshot,
} from '../../../packages/remote/src';

export {
  decodeProfileShare,
  encodeProfilePayload,
  encodeProfileShare,
  type DecodedProfileShare,
  type ProfileAttestation,
  type ProfileIdentity,
  type PublicProfileRanking,
  type PublicProfileSnapshot,
} from '../../../packages/remote/src';

export type ProfileUsageSnapshot = RemoteUsageSnapshot;

export function createPublicProfileSnapshot(
  profile: ProfileIdentity,
  usage: ProfileUsageSnapshot,
  generatedAt = Date.now(),
): PublicProfileSnapshot {
  if (usage.sync.status !== 'ready') {
    throw new Error(
      usage.sync.status === 'error'
        ? 'Local usage indexing needs attention before you can share this profile.'
        : 'Local usage is still indexing. Refresh the profile when it finishes.',
    );
  }
  const value = parsePublicProfileSnapshot({
    version: 3,
    ...profile,
    generatedAt,
    lifetimeTokens: usage.lifetimeTokens,
    tokensComplete: usage.totals.tokensComplete,
    peakDayTokens: usage.peakDayTokens,
    sessions: usage.sessions,
    currentStreak: usage.currentStreak,
    longestStreak: usage.longestStreak,
    trackingSince: usage.trackingSince,
    days: usage.days.map(({ date, tokens, complete }) => ({ date, tokens, complete })),
    harnesses: usage.harnesses.map(({ name, sessions }) => ({ name, sessions })),
    models: usage.models.map(({ name, sessions }) => ({ name, sessions })),
  });
  if (!value) throw new Error('Complete your name and username before sharing your profile.');
  return value;
}
