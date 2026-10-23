import { useEffect, useState, type ReactNode } from 'react';
import { MotionConfig, motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import { Check, Download, Link, ShieldCheck } from '@droidex/icons';
import type { PublicProfileSnapshot } from '../../packages/remote/src/profile';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { pixelCreature } from '../../src/lib/pixelCreature';
import { ProfileAvatar, profileSeed } from '../../src/features/profile/ProfileAvatar';
import { ProfileBanner } from '../../src/features/profile/ProfileBanner';
import { downloadProfileCard } from '../../src/features/profile/profileCard';
import { dateFromDayKey } from '../../src/features/profile/activityCalendar';
import { ActivityHeatmap } from './ActivityHeatmap';
import { EASE_OUT, GateHeader } from './GateLayout';

const GET_DROIDEX_URL = 'https://github.com/droidex-anas/droidex-releases#readme';
const COPIED_MS = 1400;
const AVATAR_SIZE = 136;
// Follows the avatar's own corner (26% of its size) out by the plate's 6px padding.
const AVATAR_PLATE_RADIUS = AVATAR_SIZE * 0.26 + 6;
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat();

export function GetDroidexButton({
  variant,
  size,
  className,
}: {
  variant: 'primary' | 'ghost';
  size: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => {
        window.location.assign(GET_DROIDEX_URL);
      }}
    >
      Get DROIDEX
    </Button>
  );
}

function dayCount(count: number) {
  return `${integer.format(count)} ${count === 1 ? 'day' : 'days'}`;
}

function formatDay(day: string) {
  return dateFromDayKey(day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function rise(index: number) {
  return { animationDelay: `${String(index * 60)}ms` };
}

export function PublicProfilePage({ profile }: { profile: PublicProfileSnapshot }) {
  const seed = profileSeed(profile);
  const { color } = pixelCreature(seed);
  const [copied, setCopied] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const isMinimum = profile.tokensReported && !profile.tokensComplete;
  const tokens = (value: number) =>
    profile.tokensReported ? `${isMinimum ? '≥ ' : ''}${compact.format(value)}` : 'Unknown';

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, COPIED_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [copied]);

  const copyLink = () => {
    void navigator.clipboard
      .writeText(`${window.location.origin}/public/${encodeURIComponent(profile.username)}`)
      .then(() => {
        setCopied(true);
        setError('');
      })
      .catch(() => {
        setError('Couldn’t copy automatically. Copy this page’s address instead.');
      });
  };
  const saveCard = async () => {
    setRendering(true);
    setError('');
    try {
      await downloadProfileCard(profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Couldn’t render the profile card.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <MotionConfig reducedMotion="user">
      <div className="fixed inset-0 overflow-y-auto bg-bg text-primary">
        <GateHeader label="Profile">
          <GetDroidexButton variant="ghost" size="sm" />
        </GateHeader>

        <main className="remote-gate-bottom mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 pt-2 md:px-8">
          <div className="droid-rise overflow-hidden rounded-2xl">
            <ProfileBanner
              days={profile.days}
              end={dateFromDayKey(profile.generatedDay)}
              color={color}
              height={168}
            />
          </div>

          <div className="flex flex-col gap-6 px-1 md:flex-row md:gap-8 md:px-2">
            <aside
              className="droid-rise flex flex-col items-start md:w-64 md:shrink-0"
              style={rise(1)}
            >
              <div className="-mt-20 bg-bg p-1.5" style={{ borderRadius: AVATAR_PLATE_RADIUS }}>
                <ProfileAvatar seed={seed} size={AVATAR_SIZE} />
              </div>
              <h1 className="mt-4 break-words text-title text-primary">{profile.displayName}</h1>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-body-lg text-secondary">
                @{profile.username}
                <Badge tone="success" icon={ShieldCheck} title="Signed on this person’s laptop">
                  Verified
                </Badge>
              </p>
              {profile.currentStreak > 0 && (
                <p className="mt-3 flex items-center gap-1.5 text-label text-secondary">
                  <Flame className="size-icon-sm" style={{ color }} aria-hidden="true" />
                  {dayCount(profile.currentStreak)} streak
                </p>
              )}
              <div className="mt-5 flex w-full gap-2">
                <Button
                  variant="primary"
                  className="flex-1"
                  icon={copied ? Check : Link}
                  onClick={copyLink}
                >
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
                <Button
                  className="flex-1"
                  icon={Download}
                  loading={rendering}
                  onClick={() => void saveCard()}
                >
                  Save card
                </Button>
              </div>
              {error && (
                <p role="alert" className="mt-2 text-caption text-danger">
                  {error}
                </p>
              )}
              <p className="mt-4 text-caption text-muted">
                Tracking since{' '}
                {dateFromDayKey(profile.trackingDay).toLocaleDateString(undefined, {
                  month: 'long',
                  year: 'numeric',
                })}
              </p>
            </aside>

            <div className="flex min-w-0 flex-1 flex-col gap-3 md:pt-4">
              <dl className="droid-rise grid grid-cols-2 gap-2 md:grid-cols-4" style={rise(2)}>
                <Stat
                  value={tokens(profile.lifetimeTokens)}
                  label={isMinimum ? 'Measured tokens' : 'Lifetime tokens'}
                />
                <Stat value={integer.format(profile.sessions)} label="DROIDEX sessions" />
                <Stat value={tokens(profile.peakDayTokens)} label="Peak day" />
                <Stat value={dayCount(profile.longestStreak)} label="Longest streak" />
              </dl>
              <ActivityHeatmap
                days={profile.days}
                endDay={profile.generatedDay}
                trackingDay={profile.trackingDay}
                color={color}
                tokensReported={profile.tokensReported}
              />
              <div className="droid-rise grid gap-3 md:grid-cols-2" style={rise(4)}>
                <Ranking title="Top harnesses" rows={profile.harnesses} color={color} />
                <Ranking title="Top models" rows={profile.models} color={color} />
              </div>
            </div>
          </div>

          <footer className="flex items-start gap-2 px-1 pb-6 text-caption text-muted md:px-2">
            <ShieldCheck className="mt-0.5 size-icon-sm shrink-0" aria-hidden="true" />
            <p>
              Published {formatDay(profile.generatedDay)}. Public totals only: no prompts,
              responses, chats, files, paths, costs, device data or workspace details.
              {!profile.tokensReported &&
                ' Token totals are unavailable because the indexed sessions did not report them.'}
              {isMinimum &&
                ' Some harness logs omit token counts, so totals marked ≥ are measured minimums.'}
            </p>
          </footer>
        </main>
      </div>
    </MotionConfig>
  );
}

function Stat({ value, label }: { value: ReactNode; label: string }) {
  return (
    <div className="flex flex-col-reverse rounded-lg bg-surface px-4 py-3">
      <dt className="mt-0.5 text-caption text-muted">{label}</dt>
      <dd className="text-heading tabular-nums text-primary">{value}</dd>
    </div>
  );
}

function Ranking({
  title,
  rows,
  color,
}: {
  title: string;
  rows: { name: string; sessions: number }[];
  color: string;
}) {
  const top = Math.max(1, ...rows.map((row) => row.sessions));
  return (
    <section className="rounded-2xl bg-surface p-4">
      <h2 className="px-1 text-body-strong text-primary">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-2 px-1 text-caption text-muted">Nothing measured yet.</p>
      ) : (
        <ol className="mt-3 flex flex-col gap-3 px-1">
          {rows.map((row, index) => (
            <li key={row.name}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-body text-secondary" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 text-caption tabular-nums text-muted">
                  {integer.format(row.sessions)} {row.sessions === 1 ? 'session' : 'sessions'}
                </span>
              </div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-elevated">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: `color-mix(in srgb, ${color} ${String(index === 0 ? 85 : 50)}%, var(--elevated))`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${String((row.sessions / top) * 100)}%` }}
                  transition={{ duration: 0.7, ease: EASE_OUT, delay: 0.3 + index * 0.06 }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
