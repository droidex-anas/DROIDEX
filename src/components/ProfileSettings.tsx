import { AnimatePresence, MotionConfig, motion } from 'framer-motion';
import { useMemo, useState, type ReactNode } from 'react';
import { Activity, Link, Lock, Pencil, RefreshCw } from '@droidex/icons';
import { HANDLE_PATTERN, hasReportedTokens } from '../../packages/remote/src';
import { pixelCreature } from '../lib/pixelCreature';
import { ProfileActivity } from '../features/profile/ProfileActivity';
import { ProfileAvatar, profileSeed } from '../features/profile/ProfileAvatar';
import { ProfileBanner } from '../features/profile/ProfileBanner';
import { ProfileIdentityForm } from '../features/profile/ProfileIdentityForm';
import { ProfileBreakdown } from '../features/profile/ProfileBreakdown';
import { HeroStats, StatsSkeleton } from '../features/profile/ProfileStats';
import { ProfileSyncState } from '../features/profile/ProfileSyncState';
import { ProfileUsageDetails } from '../features/profile/ProfileUsageDetails';
import { dateFromDayKey, dayKeyInTimeZone } from '../features/profile/activityCalendar';
import {
  createPublicProfileSnapshot,
  type ProfileIdentity,
  type ProfileUsageSnapshot,
  type PublicProfileSnapshot,
} from '../features/profile/profileShare';
import { useProfilePublication } from '../features/profile/useProfilePublication';
import { useProfileUsage } from '../features/profile/useProfileUsage';
import { ProfileSharePanel } from './ProfileSharePanel';
import { Button } from './ui/Button';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const OFFICIAL_CLIENT_URL = 'https://droidex.vercel.app';
const AVATAR_SIZE = 88;
const AVATAR_FRAME = 6;
const MODELS_SHOWN = 5;

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
  webClientUrl = OFFICIAL_CLIENT_URL,
  usernameLocked,
  publishingReady,
}: {
  profile: ProfileIdentity;
  onProfileChange: (profile: ProfileIdentity) => Promise<unknown>;
  webClientUrl?: string;
  usernameLocked?: boolean;
  publishingReady: boolean;
}) {
  const { usage, loading, error: usageError, refresh } = useProfileUsage();
  const publication = useProfilePublication(profile.username, publishingReady);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  const syncStatus = usage?.sync.status;

  const snapshotResult = useMemo<{ snapshot: PublicProfileSnapshot | null; error: string }>(() => {
    if (usage?.sync.status !== 'ready' || !isIdentityComplete(profile)) {
      return { snapshot: null, error: '' };
    }
    try {
      return { snapshot: createPublicProfileSnapshot(profile, usage), error: '' };
    } catch (cause) {
      return {
        snapshot: null,
        error: cause instanceof Error ? cause.message : 'Could not prepare your public profile.',
      };
    }
  }, [profile, usage]);
  const currentSnapshot = snapshotResult.snapshot;

  const startEditing = () => {
    setDraft(profile);
    setShareOpen(false);
    setEditing(true);
  };
  const save = async () => {
    setSaving(true);
    setSaveError('');
    try {
      await onProfileChange({
        displayName: draft.displayName.trim(),
        username: draft.username.trim().toLowerCase(),
      });
      setEditing(false);
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };
  const publish = async () => {
    if (!currentSnapshot) return;
    if (await publication.publish(currentSnapshot)) setShareOpen(true);
  };
  const unpublish = async () => {
    if ((await publication.unpublish()) && !currentSnapshot) setShareOpen(false);
  };

  const published = publication.publication;
  const seed = profileSeed(editing ? draft : profile);
  const { color } = pixelCreature(seed);
  const blocker =
    shareBlocker(
      profile,
      usage,
      publishingReady,
      published !== null || publication.known,
      publication.checking,
    ) || snapshotResult.error;
  const publicationUnverified =
    publishingReady && HANDLE_PATTERN.test(profile.username) && !publication.known;
  const shareSnapshot = published?.profile ?? (publication.known ? currentSnapshot : null);
  const readyUsage = syncStatus === 'ready' ? usage : null;
  const hasActivity =
    readyUsage !== null && (readyUsage.totals.events > 0 || readyUsage.sessions > 0);
  const error = saveError || usageError;

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-3xl space-y-3 pb-10">
        <Rise index={0}>
          <section aria-label="Your profile" className="overflow-hidden rounded-xl bg-surface">
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
                <div
                  className="relative bg-surface"
                  style={{
                    padding: AVATAR_FRAME,
                    borderRadius: AVATAR_SIZE * 0.26 + AVATAR_FRAME,
                  }}
                >
                  <ProfileAvatar seed={seed} size={AVATAR_SIZE} />
                </div>
                {!editing && (
                  <div className="flex items-center gap-2 pb-1">
                    <Button icon={Pencil} onClick={startEditing}>
                      Edit profile
                    </Button>
                    <Button
                      variant="primary"
                      icon={Link}
                      disabled={
                        publication.mutation !== null ||
                        (published === null && (publication.checking || blocker !== ''))
                      }
                      title={published === null ? blocker || undefined : undefined}
                      aria-expanded={shareOpen}
                      onClick={() => {
                        setShareOpen((open) => !open);
                      }}
                    >
                      {published ? 'Published' : 'Share'}
                    </Button>
                  </div>
                )}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                {editing ? (
                  <ProfileIdentityForm
                    key="edit"
                    draft={draft}
                    onDraftChange={setDraft}
                    usernameLocked={
                      published !== null || usernameLocked === true || publicationUnverified
                    }
                    usernameHint={usernameHelp(
                      published !== null,
                      usernameLocked === true,
                      publicationUnverified,
                    )}
                    saving={saving}
                    onCancel={() => {
                      setEditing(false);
                    }}
                    onSave={() => void save()}
                  />
                ) : (
                  <motion.div
                    key="view"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.2, ease: EASE }}
                    className="mt-3"
                  >
                    <h1 className="truncate text-title text-primary">
                      {profile.displayName || 'Your profile'}
                    </h1>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 text-body text-muted">
                      {profile.username ? (
                        <span className="text-secondary">@{profile.username}</span>
                      ) : (
                        <button
                          type="button"
                          className="rounded-xs text-secondary underline decoration-muted/50 underline-offset-2 transition-colors hover:text-primary"
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
                    {blocker && <p className="mt-2 text-caption text-muted">{blocker}</p>}
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
              url={profileUrl(webClientUrl, profile.username)}
              snapshot={shareSnapshot}
              published={published !== null}
              mutation={publication.mutation}
              updateBlocked={blocker}
              mutationError={publication.error}
              onPublish={() => void publish()}
              onUpdate={() => void publish()}
              onUnpublish={() => void unpublish()}
              onClose={() => {
                setShareOpen(false);
              }}
            />
          )}
        </AnimatePresence>

        {publication.error && !shareOpen && (
          <p role="alert" className="px-1 text-label text-danger">
            {publication.error}
          </p>
        )}

        {error && (
          <p role="alert" className="px-1 text-label text-danger">
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

        {readyUsage && !hasActivity && <EmptyProfile color={color} />}

        {readyUsage && hasActivity && (
          <>
            <Rise index={1}>
              <ProfileActivity
                usage={readyUsage}
                color={color}
                tokensReported={hasReportedTokens(readyUsage)}
              />
            </Rise>
            <Rise index={2}>
              <ProfileUsageDetails usage={readyUsage} />
            </Rise>
            <Rise index={3}>
              <ProfileBreakdown
                title="Harnesses"
                rows={readyUsage.harnesses}
                mostUsedId={readyUsage.mostUsedHarness}
                color={color}
              />
            </Rise>
            <Rise index={4}>
              <ProfileBreakdown
                title="Models"
                rows={readyUsage.models}
                color={color}
                limit={MODELS_SHOWN}
              />
            </Rise>
          </>
        )}

        {readyUsage && (
          <Rise index={5} className="flex items-start justify-between gap-4 px-1 pt-2">
            <p className="flex max-w-xl gap-1.5 text-caption text-muted">
              <Lock className="mt-0.5 size-icon-sm shrink-0" aria-hidden="true" />
              Counted on this computer from Claude Code, Codex, Droid and OpenCode history. Prompts
              and responses never enter the ledger. Values a provider did not report stay unknown.
            </p>
            <Button
              variant="ghost"
              icon={RefreshCw}
              loading={loading}
              disabled={loading}
              onClick={() => void refresh()}
            >
              Refresh
            </Button>
          </Rise>
        )}
      </div>
    </MotionConfig>
  );
}

function EmptyProfile({ color }: { color: string }) {
  return (
    <Rise index={1}>
      <section className="flex flex-col items-center rounded-xl bg-surface px-6 py-10 text-center">
        <span
          className="flex size-10 items-center justify-center rounded-lg"
          style={{ background: `color-mix(in srgb, ${color} 18%, var(--elevated))`, color }}
        >
          <Activity className="size-icon-lg" aria-hidden="true" />
        </span>
        <h3 className="mt-3 text-body-strong text-primary">No activity yet</h3>
        <p className="mt-1 max-w-sm text-label font-normal text-muted">
          Every source is indexed and nothing has been measured. Start a chat in DROIDEX, Claude
          Code, Codex, Droid or OpenCode, then refresh.
        </p>
      </section>
    </Rise>
  );
}
