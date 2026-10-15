import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { BadgeCheck, Check, Flame, ImageDown, Link2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { HANDLE_PATTERN, type PublicProfileSnapshot } from '../../packages/remote/src/profile';
import { pixelCreature } from '../../src/lib/pixelCreature';
import { ProfileAvatar, profileSeed } from '../../src/features/profile/ProfileAvatar';
import { ProfileBanner } from '../../src/features/profile/ProfileBanner';
import { downloadProfileCard } from '../../src/features/profile/profileCard';
import { dateFromDayKey } from '../../src/features/profile/activityCalendar';
import { ActivityHeatmap } from './ActivityHeatmap';
import { Brand } from './Brand';
import { loadPublishedProfile, type ProfileLoadResult } from './profileVerification';
import './profile.css';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat();
const GET_DROIDEX_URL = 'https://github.com/droidex-anas/droidex-releases#readme';

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

function ProfileState({
  icon,
  title,
  children,
  busy,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  busy?: boolean;
}) {
  return (
    <main className="profile-state">
      <Brand />
      <div className={`profile-state-symbol ${busy ? 'busy' : ''}`}>{icon}</div>
      <h1>{title}</h1>
      {children}
    </main>
  );
}

export function PublicProfile({ username }: { username: string }) {
  const validUsername = HANDLE_PATTERN.test(username);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<ProfileLoadResult | { status: 'loading' }>({
    status: 'loading',
  });
  useEffect(() => {
    if (!validUsername) return;
    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      controller.abort();
    }, 8_000);
    setResult({ status: 'loading' });
    void loadPublishedProfile(username, controller.signal)
      .then((next) => {
        if (active) setResult(next);
      })
      .finally(() => {
        window.clearTimeout(timeout);
      });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt, username, validUsername]);

  if (!validUsername)
    return (
      <ProfileState
        icon={<Link2 size={26} strokeWidth={1.6} />}
        title="This profile link is invalid."
      >
        <p>Check the username in the link, or ask its owner to share it again.</p>
        <a className="primary button-link" href={GET_DROIDEX_URL} rel="noreferrer">
          Get DROIDEX
        </a>
      </ProfileState>
    );
  if (result.status === 'loading')
    return (
      <ProfileState
        busy
        icon={<ShieldCheck size={26} strokeWidth={1.6} />}
        title="Loading profile…"
      >
        <p>Fetching @{username}’s published usage and checking its signature.</p>
      </ProfileState>
    );
  if (result.status === 'not-published')
    return (
      <ProfileState icon={<Link2 size={26} strokeWidth={1.6} />} title="Profile not published">
        <p>@{username} has not published a public usage profile.</p>
        <button
          className="primary button-link"
          onClick={() => {
            setAttempt((value) => value + 1);
          }}
        >
          Check again
        </button>
      </ProfileState>
    );
  if (result.status === 'unavailable')
    return (
      <ProfileState icon={<ShieldAlert size={26} strokeWidth={1.6} />} title="Profile unavailable">
        <p>DROIDEX could not reach the profile service. Try again in a moment.</p>
        <button
          className="primary button-link"
          onClick={() => {
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </ProfileState>
    );
  if (result.status === 'unverified')
    return (
      <ProfileState
        icon={<ShieldAlert size={26} strokeWidth={1.6} />}
        title="This profile could not be verified."
      >
        <p>
          The published data does not match @{username}’s signature. Ask its owner to publish the
          profile again.
        </p>
        <button
          className="primary button-link"
          onClick={() => {
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </ProfileState>
    );
  return <ProfilePage profile={result.profile} />;
}

function ProfilePage({ profile }: { profile: PublicProfileSnapshot }) {
  const seed = profileSeed(profile);
  const { color } = pixelCreature(seed);
  const [copied, setCopied] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');
  const minimum = profile.tokensComplete ? '' : '≥ ';
  const lifetimeTokens = profile.tokensReported
    ? `${minimum}${compact.format(profile.lifetimeTokens)}`
    : 'Unknown';
  const peakDayTokens = profile.tokensReported
    ? `${minimum}${compact.format(profile.peakDayTokens)}`
    : 'Unknown';

  useEffect(() => {
    document.title = `${profile.displayName} (@${profile.username}) · DROIDEX`;
  }, [profile]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1400);
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
        setError('Could not copy automatically. Copy this page’s address instead.');
      });
  };
  const saveCard = async () => {
    setRendering(true);
    setError('');
    try {
      await downloadProfileCard(profile);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not render the profile card.');
    } finally {
      setRendering(false);
    }
  };

  return (
    <main className="public-profile" style={{ '--profile-color': color } as CSSProperties}>
      <header className="profile-toolbar">
        <Brand />
        <a className="profile-get" href={GET_DROIDEX_URL} rel="noreferrer">
          Get DROIDEX
        </a>
      </header>

      <div className="profile-cover rise">
        <ProfileBanner
          days={profile.days}
          end={dateFromDayKey(profile.generatedDay)}
          color={color}
          height={168}
        />
      </div>

      <div className="profile-layout">
        <aside className="profile-sidebar rise" style={{ animationDelay: '60ms' }}>
          <div className="profile-avatar">
            <ProfileAvatar seed={seed} size={168} />
          </div>
          <h1>{profile.displayName}</h1>
          <p className="profile-handle">
            @{profile.username}
            <span className="profile-verified" title="Signature matches the username registry">
              <BadgeCheck size={15} /> Verified
            </span>
          </p>
          {profile.currentStreak > 0 && (
            <p className="profile-streak">
              <Flame size={14} /> {dayCount(profile.currentStreak)} streak
            </p>
          )}
          <div className="profile-actions">
            <button className="primary" onClick={copyLink}>
              {copied ? <Check size={16} /> : <Link2 size={16} />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <button disabled={rendering} onClick={() => void saveCard()}>
              <ImageDown size={16} />
              {rendering ? 'Rendering…' : 'Save card'}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="profile-since">
            Usage tracked since{' '}
            {dateFromDayKey(profile.trackingDay).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </aside>

        <div className="profile-main">
          <dl className="profile-stats rise" style={{ animationDelay: '120ms' }}>
            <Stat
              value={lifetimeTokens}
              label={
                profile.tokensReported && !profile.tokensComplete
                  ? 'Measured tokens (minimum)'
                  : 'Lifetime tokens'
              }
            />
            <Stat value={integer.format(profile.sessions)} label="DROIDEX sessions" />
            <Stat
              value={peakDayTokens}
              label={
                profile.tokensReported && !profile.tokensComplete
                  ? 'Peak day (minimum)'
                  : 'Peak day'
              }
            />
            <Stat value={dayCount(profile.longestStreak)} label="Longest streak" />
          </dl>
          <ActivityHeatmap
            className="rise"
            days={profile.days}
            endDay={profile.generatedDay}
            trackingDay={profile.trackingDay}
            color={color}
            tokensReported={profile.tokensReported}
          />
          <div className="profile-rankings rise" style={{ animationDelay: '240ms' }}>
            <Ranking title="Harnesses" rows={profile.harnesses} />
            <Ranking title="Models" rows={profile.models} />
          </div>
        </div>
      </div>

      <footer className="profile-note">
        <ShieldCheck size={15} />
        <p>
          Published {formatDay(profile.generatedDay)}. Public aggregates only: no prompts,
          responses, chats, files, paths, costs, device data or workspace details.
          {!profile.tokensReported
            ? ' Token totals are unavailable because the indexed sessions did not report them.'
            : !profile.tokensComplete &&
              ' Some harness logs omit token counts, so totals marked ≥ are measured minimums.'}
        </p>
      </footer>
    </main>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <dd>{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function Ranking({ title, rows }: { title: string; rows: { name: string; sessions: number }[] }) {
  const top = Math.max(1, ...rows.map((row) => row.sessions));
  return (
    <section className="surface ranking">
      <h2>{title}</h2>
      {rows.length ? (
        <ol>
          {rows.map((row, index) => (
            <li key={row.name}>
              <div className="ranking-label">
                <strong>{row.name}</strong>
                <span className="muted">
                  {integer.format(row.sessions)} {row.sessions === 1 ? 'session' : 'sessions'}
                </span>
              </div>
              <div className="ranking-track">
                <span
                  className={index === 0 ? 'lead' : ''}
                  style={{
                    width: `${String((row.sessions / top) * 100)}%`,
                    animationDelay: `${String(300 + index * 60)}ms`,
                  }}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nothing measured yet.</p>
      )}
    </section>
  );
}
