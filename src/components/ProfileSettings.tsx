import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { Lock, Pencil, RefreshCw, Share2, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { HANDLE_PATTERN, hasReportedTokens } from '../../packages/remote/src';
import { pixelCreature } from '../lib/pixelCreature';
import { ProfileActivity } from '../features/profile/ProfileActivity';
import { ProfileAvatar, profileSeed } from '../features/profile/ProfileAvatar';
import { ProfileBanner } from '../features/profile/ProfileBanner';
import { HeroStats, ProfileRanking, StatsSkeleton } from '../features/profile/ProfileStats';
import { ProfileSyncState } from '../features/profile/ProfileSyncState';
import { ProfileUsageDetails } from '../features/profile/ProfileUsageDetails';
import { dateFromDayKey, dayKeyInTimeZone } from '../features/profile/activityCalendar';
import {
  createPublicProfileSnapshot,
  encodeProfilePayload,
  verifyPublishedProfile,
  type DecodedPublishedProfile,
  type ProfileIdentity,
  type ProfileUsageSnapshot,
  type PublicProfileSnapshot,
} from '../features/profile/profileShare';
import { ghostButton, primaryButton, secondaryButton } from './buttonStyles';
import { ProfileSharePanel } from './ProfileSharePanel';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const INDEXING_POLL_MS = 4000;
const OFFICIAL_CLIENT_URL = 'https://droidex.vercel.app';
const fieldClass =
  'mt-1.5 block h-9 w-full rounded-lg bg-droid-elevated px-3 text-[13px] text-droid-text transition-colors placeholder:text-droid-text-muted focus:outline-none focus-visible:bg-droid-active disabled:opacity-50';

function errorMessage(cause: unknown, message: string) {
  return cause instanceof Error ? cause.message : message;
}

function isIdentityComplete(profile: ProfileIdentity) {
  return profile.displayName.trim() !== '' && HANDLE_PATTERN.test(profile.username);
}

function shareBlocker(
  profile: ProfileIdentity,
  usage: ProfileUsageSnapshot | null,
  publishingReady: boolean,
  publicationResolved: boolean,
  publicationLoading: boolean,
) {
  if (!isIdentityComplete(profile)) return 'Add your name and username to share.';
  if (!publishingReady) return 'Finish Remote setup before publishing your profile.';
  if (!publicationResolved) {
    return publicationLoading
      ? 'Checking your public profile…'
      : 'Could not verify your public profile status. Check Remote and try again.';
  }
  if (!usage) return 'Reading your local usage…';
  if (usage.sync.status === 'indexing') return 'Sharing unlocks when indexing finishes.';
  if (usage.sync.status === 'error') return 'Sharing is off until indexing is fixed.';
  return '';
}

function profileUrl(clientUrl: string, username: string) {
  try {
    return `${new URL(clientUrl).origin}/public/${encodeURIComponent(username)}`;
  } catch {
    return `${OFFICIAL_CLIENT_URL}/public/${encodeURIComponent(username)}`;
  }
}

function usernameHelp(published: boolean, paired: boolean, publicationStatusUnknown: boolean) {
  if (published) {
    return 'Your username is fixed while this profile is public. Unpublish it before changing the username.';
  }
  if (paired) {
    return 'Your username is fixed while a phone is paired. Reset pairing in Remote to change it.';
  }
  if (publicationStatusUnknown) {
    return 'Your username stays fixed until its public profile status is verified.';
  }
  return 'Your avatar is drawn from your username, and it is your Remote address. 3–30 lowercase letters, numbers or hyphens.';
}

async function readPublishedProfile(username: string): Promise<DecodedPublishedProfile | null> {
  const api = window.droidControl;
  if (!api) throw new Error('Profile publishing is available in the desktop app.');
  const value = await api.getPublishedProfile();
  if (!value) return null;
  const published = await verifyPublishedProfile(value, username);
  if (!published) throw new Error('The published profile could not be verified. Publish it again.');
  return published;
}

function Rise({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: EASE, delay: index * 0.06 }}
    >
      {children}
    </motion.div>
  );
}

export function ProfileSettings({
  profile,
  onProfileChange,
  webClientUrl = 'https://droidex.vercel.app',
  usernameLocked,
  publishingReady,
}: {
  profile: ProfileIdentity;
  onProfileChange: (profile: ProfileIdentity) => Promise<unknown>;
  webClientUrl?: string;
  usernameLocked?: boolean;
  publishingReady: boolean;
}) {
  const [usage, setUsage] = useState<ProfileUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const [publication, setPublication] = useState<DecodedPublishedProfile | null>(null);
  const [publicationLookup, setPublicationLookup] = useState<{
    username: string;
    state: 'unknown' | 'checking' | 'known';
  }>({ username: '', state: 'unknown' });
  const [publicationError, setPublicationError] = useState('');
  const [profileMutation, setProfileMutation] = useState<'publish' | 'update' | 'unpublish' | null>(
    null,
  );
  const syncStatus = usage?.sync.status;

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      if (!window.droidControl) throw new Error('Local usage is available in the desktop app.');
      setUsage(await window.droidControl.getProfileUsage());
    } catch (cause) {
      setError(errorMessage(cause, 'Could not read local usage.'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    void window.droidControl
      ?.getProfileUsage()
      .then((snapshot) => {
        if (active) setUsage(snapshot);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorMessage(cause, 'Could not read local usage.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    if (!window.droidControl) {
      setLoading(false);
      setError('Local usage is available in the desktop app.');
    }
    return () => {
      active = false;
    };
  }, []);

  // Indexing finishes in the sidecar without notifying the renderer, so poll
  // until every source settles.
  useEffect(() => {
    if (syncStatus !== 'indexing') return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const snapshot = await window.droidControl?.getProfileUsage();
        if (active && snapshot) setUsage(snapshot);
      } catch {
        // A manual refresh exposes persistent errors. Keep polling transient failures.
      }
      if (active) timer = setTimeout(() => void poll(), INDEXING_POLL_MS);
    };
    timer = setTimeout(() => void poll(), INDEXING_POLL_MS);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [syncStatus]);

  useEffect(() => {
    let active = true;
    setPublicationError('');
    if (!publishingReady || !HANDLE_PATTERN.test(profile.username)) {
      setPublicationLookup({ username: profile.username, state: 'unknown' });
      return () => {
        active = false;
      };
    }
    setPublicationLookup({ username: profile.username, state: 'checking' });
    void readPublishedProfile(profile.username)
      .then((value) => {
        if (!active) return;
        setPublication(value);
        setPublicationLookup({ username: profile.username, state: 'known' });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setPublicationLookup({ username: profile.username, state: 'unknown' });
        setPublicationError(errorMessage(cause, 'Could not check your public profile.'));
      });
    return () => {
      active = false;
    };
  }, [profile.username, publishingReady]);

  const currentSnapshot = useMemo<PublicProfileSnapshot | null>(() => {
    if (usage?.sync.status !== 'ready' || !isIdentityComplete(profile)) return null;
    try {
      return createPublicProfileSnapshot(profile, usage);
    } catch {
      return null;
    }
  }, [profile, usage]);
  const currentPublication =
    publication?.profile.username === profile.username ? publication : null;
  const publicationKnown =
    publicationLookup.username === profile.username && publicationLookup.state === 'known';
  const publicationLoading =
    publicationLookup.username === profile.username && publicationLookup.state === 'checking';

  const startEditing = () => {
    setDraft(profile);
    setShareOpen(false);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onProfileChange({
        displayName: draft.displayName.trim(),
        username: draft.username.trim().toLowerCase(),
      });
      setEditing(false);
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save your profile.'));
    } finally {
      setSaving(false);
    }
  };

  const refetchPublication = async () => {
    const username = profile.username;
    setPublicationLookup({ username, state: 'checking' });
    try {
      setPublication(await readPublishedProfile(username));
      setPublicationLookup({ username, state: 'known' });
    } catch {
      // Keep the last verified publication visible if the conflict refresh fails.
      setPublicationLookup({ username, state: 'unknown' });
    }
  };

  const publish = async () => {
    if (!publishingReady || !currentSnapshot) return;
    if (!currentPublication && !publicationKnown) return;
    const mutation = currentPublication ? 'update' : 'publish';
    setProfileMutation(mutation);
    setPublicationError('');
    try {
      const api = window.droidControl;
      if (!api) throw new Error('Profile publishing is available in the desktop app.');
      const next = await api.publishPublicProfile(encodeProfilePayload(currentSnapshot));
      const verified = await verifyPublishedProfile(next, profile.username);
      if (!verified) throw new Error('The published profile could not be verified.');
      setPublication(verified);
      setPublicationLookup({ username: profile.username, state: 'known' });
      setShareOpen(true);
    } catch (cause) {
      const message = errorMessage(cause, 'Could not publish your profile.');
      setPublicationError(message);
      if (/public profile changed/i.test(message)) await refetchPublication();
    } finally {
      setProfileMutation(null);
    }
  };

  const unpublish = async () => {
    if (!currentPublication) return;
    setProfileMutation('unpublish');
    setPublicationError('');
    try {
      const api = window.droidControl;
      if (!api) throw new Error('Profile publishing is available in the desktop app.');
      await api.revokePublicProfile(currentPublication.payload);
      setPublication(null);
      setPublicationLookup({ username: profile.username, state: 'known' });
      if (!currentSnapshot) setShareOpen(false);
    } catch (cause) {
      const message = errorMessage(cause, 'Could not unpublish your profile.');
      setPublicationError(message);
      if (/public profile changed/i.test(message)) await refetchPublication();
    } finally {
      setProfileMutation(null);
    }
  };

  const seed = profileSeed(editing ? draft : profile);
  const { color } = pixelCreature(seed);
  const blocker = shareBlocker(
    profile,
    usage,
    publishingReady,
    currentPublication !== null || publicationKnown,
    publicationLoading,
  );
  const usernameIsLocked =
    currentPublication !== null ||
    usernameLocked === true ||
    (publishingReady && HANDLE_PATTERN.test(profile.username) && !publicationKnown);
  const usernameDescription = usernameHelp(
    currentPublication !== null,
    usernameLocked === true,
    publishingReady && HANDLE_PATTERN.test(profile.username) && !publicationKnown,
  );
  const shareSnapshot = currentPublication?.profile ?? (publicationKnown ? currentSnapshot : null);
  const shareUrl = profileUrl(webClientUrl, profile.username);
  const readyUsage = syncStatus === 'ready' ? usage : null;
  const hasActivity =
    readyUsage !== null && (readyUsage.totals.events > 0 || readyUsage.sessions > 0);
  const isEmpty = readyUsage !== null && !hasActivity;
  const tokensReported = readyUsage !== null && hasReportedTokens(readyUsage);

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-3xl space-y-3 pb-10">
        <Rise index={0}>
          <section
            aria-label="Your profile"
            className="overflow-hidden rounded-2xl bg-droid-surface"
          >
            <ProfileBanner
              days={readyUsage?.days ?? []}
              end={
                readyUsage
                  ? dateFromDayKey(dayKeyInTimeZone(Date.now(), readyUsage.timeZone))
                  : new Date()
              }
              color={color}
              height={112}
            />
            <div className="px-6 pb-6">
              <div className="-mt-11 flex items-end justify-between gap-3">
                <div className="relative rounded-[28px] bg-droid-surface p-1.5">
                  <ProfileAvatar seed={seed} size={88} />
                </div>
                {!editing && (
                  <div className="flex items-center gap-2 pb-1">
                    <button className={secondaryButton} onClick={startEditing}>
                      <Pencil size={13} /> Edit profile
                    </button>
                    <button
                      className={primaryButton}
                      disabled={
                        profileMutation !== null ||
                        (currentPublication === null && (publicationLoading || blocker !== ''))
                      }
                      title={currentPublication === null ? blocker || undefined : undefined}
                      aria-expanded={shareOpen}
                      onClick={() => {
                        setShareOpen((open) => !open);
                      }}
                    >
                      <Share2 size={13} /> {currentPublication ? 'Published' : 'Share'}
                    </button>
                  </div>
                )}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {editing ? (
                  <motion.form
                    key="edit"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="mt-4"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void save();
                    }}
                  >
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-[12px] text-droid-text-secondary">
                        Name
                        <input
                          autoFocus
                          required
                          maxLength={80}
                          placeholder="Ada Lovelace"
                          value={draft.displayName}
                          onChange={(event) => {
                            setDraft({ ...draft, displayName: event.target.value });
                          }}
                          className={fieldClass}
                        />
                      </label>
                      <label className="block text-[12px] text-droid-text-secondary">
                        Username
                        <span className="relative block">
                          <span className="pointer-events-none absolute left-3 top-1/2 mt-[3px] -translate-y-1/2 text-[13px] text-droid-text-muted">
                            @
                          </span>
                          <input
                            required
                            pattern={HANDLE_PATTERN.source.replace('-]', '\\-]')}
                            disabled={usernameIsLocked}
                            minLength={3}
                            maxLength={30}
                            placeholder="ada"
                            value={draft.username}
                            onChange={(event) => {
                              setDraft({ ...draft, username: event.target.value.toLowerCase() });
                            }}
                            className={`${fieldClass} pl-7`}
                          />
                        </span>
                      </label>
                    </div>
                    <p className="mt-2 text-[11px] leading-[18px] text-droid-text-muted">
                      {usernameDescription}
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        type="button"
                        disabled={saving}
                        className={ghostButton}
                        onClick={() => {
                          setEditing(false);
                        }}
                      >
                        Cancel
                      </button>
                      <button type="submit" disabled={saving} className={primaryButton}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </motion.form>
                ) : (
                  <motion.div
                    key="view"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="mt-3"
                  >
                    <h1 className="truncate text-[22px] font-semibold tracking-tight text-droid-text">
                      {profile.displayName || 'Your profile'}
                    </h1>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-droid-text-muted">
                      {profile.username ? (
                        <span className="text-droid-text-secondary">@{profile.username}</span>
                      ) : (
                        <button
                          className="text-droid-text-secondary underline decoration-droid-text-muted/50 underline-offset-2 transition-colors hover:text-droid-text"
                          onClick={startEditing}
                        >
                          Choose a name and username
                        </button>
                      )}
                      {readyUsage && hasActivity && (
                        <>
                          <span aria-hidden>·</span>
                          <span>
                            Since{' '}
                            {new Date(readyUsage.trackingSince).toLocaleDateString(undefined, {
                              month: 'long',
                              year: 'numeric',
                            })}
                          </span>
                        </>
                      )}
                    </div>
                    {blocker && <p className="mt-2 text-[11px] text-droid-text-muted">{blocker}</p>}
                  </motion.div>
                )}
              </AnimatePresence>

              {readyUsage && hasActivity && <HeroStats usage={readyUsage} color={color} />}
              {loading && !usage && <StatsSkeleton />}
            </div>
          </section>
        </Rise>

        <AnimatePresence initial={false}>
          {shareOpen && shareSnapshot && (
            <ProfileSharePanel
              key="share"
              url={shareUrl}
              snapshot={shareSnapshot}
              published={currentPublication !== null}
              mutation={profileMutation}
              updateBlocked={blocker}
              mutationError={publicationError}
              onPublish={() => void publish()}
              onUpdate={() => void publish()}
              onUnpublish={() => void unpublish()}
              onClose={() => {
                setShareOpen(false);
              }}
            />
          )}
        </AnimatePresence>

        {publicationError && !shareOpen && (
          <p role="alert" className="px-1 text-[12px] leading-5 text-droid-red">
            {publicationError}
          </p>
        )}

        {error && (
          <p role="alert" className="px-1 text-[12px] leading-5 text-droid-red">
            {error}
          </p>
        )}

        {usage && syncStatus !== 'ready' && (
          <ProfileSyncState
            sync={usage.sync}
            refreshing={loading}
            onRefresh={() => void refresh()}
          />
        )}

        {isEmpty && <EmptyProfile color={color} />}

        {readyUsage && hasActivity && (
          <>
            <Rise index={1}>
              <ProfileActivity usage={readyUsage} color={color} tokensReported={tokensReported} />
            </Rise>
            <Rise index={2}>
              <ProfileUsageDetails usage={readyUsage} />
            </Rise>
            <Rise index={3} className="grid gap-3 sm:grid-cols-2">
              <ProfileRanking title="Harnesses" rows={readyUsage.harnesses} color={color} />
              <ProfileRanking title="Models" rows={readyUsage.models} color={color} />
            </Rise>
          </>
        )}

        {readyUsage && (
          <Rise index={4} className="flex items-start justify-between gap-4 px-1 pt-2">
            <p className="flex max-w-xl gap-1.5 text-[11px] leading-[18px] text-droid-text-muted">
              <Lock size={12} className="mt-[3px] shrink-0" />
              Counted on this computer from Claude Code, Codex, Droid and OpenCode history. Prompts
              and responses never enter the ledger. Values a provider did not report stay unknown.
            </p>
            <button disabled={loading} className={ghostButton} onClick={() => void refresh()}>
              <RefreshCw size={13} className={loading ? 'motion-safe:animate-spin' : ''} />
              Refresh
            </button>
          </Rise>
        )}
      </div>
    </MotionConfig>
  );
}

function EmptyProfile({ color }: { color: string }) {
  return (
    <Rise index={1}>
      <section className="flex flex-col items-center rounded-2xl bg-droid-surface px-6 py-10 text-center">
        <span
          className="flex h-10 w-10 items-center justify-center rounded-xl"
          style={{ background: `color-mix(in srgb, ${color} 18%, var(--droid-elevated))`, color }}
        >
          <Sparkles size={18} />
        </span>
        <h3 className="mt-3 text-[13px] font-medium text-droid-text">No activity yet</h3>
        <p className="mt-1 max-w-sm text-[12px] leading-[18px] text-droid-text-muted">
          Every source is indexed and nothing has been measured. Start a chat in DROIDEX, Claude
          Code, Codex, Droid or OpenCode, then refresh.
        </p>
      </section>
    </Rise>
  );
}
