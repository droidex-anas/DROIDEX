import { useEffect, useMemo, useState } from 'react';
import './profile.css';
import { Check, Share2, ShieldCheck } from 'lucide-react';
import { decodeProfileShare, type PublicProfileSnapshot } from '../../packages/remote/src/profile';
import { verifyProfileShare } from './profileVerification';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat();
const formatDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function PublicProfile({ username }: { username: string }) {
  const decodedShare = useMemo(() => decodeProfileShare(window.location.hash), []);
  const profile = decodedShare?.profile;
  const [verified, setVerified] = useState<boolean | null>(null);
  const [shared, setShared] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (decodedShare?.profile.username === username) {
      void verifyProfileShare(decodedShare).then((valid) => {
        if (active) setVerified(valid);
      });
    }
    return () => {
      active = false;
    };
  }, [decodedShare, username]);
  if (profile?.username !== username)
    return (
      <main className="welcome">
        <img src="/icon.svg" width="32" height="32" alt="DROIDEX" />
        <h1>This profile link is incomplete.</h1>
        <p>Ask its owner to copy a fresh link from Settings → Profile in DROIDEX.</p>
        <a className="primary button-link" href="/">
          Open DROIDEX Remote
        </a>
      </main>
    );
  if (verified === null)
    return (
      <main className="welcome">
        <img src="/icon.svg" width="32" height="32" alt="DROIDEX" />
        <h1>Verifying this profile…</h1>
        <p>Checking its signature against the public username registry.</p>
      </main>
    );
  if (!verified)
    return (
      <main className="welcome">
        <img src="/icon.svg" width="32" height="32" alt="DROIDEX" />
        <h1>This profile could not be verified.</h1>
        <p>Ask its owner to create a fresh link from DROIDEX.</p>
        <a className="primary button-link" href="/">
          Open DROIDEX Remote
        </a>
      </main>
    );
  const initial = profile.displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
  const displayName = profile.displayName;
  async function share() {
    try {
      if (Reflect.has(navigator, 'share'))
        await navigator.share({
          title: `${displayName} on DROIDEX`,
          url: window.location.href,
        });
      else await navigator.clipboard.writeText(window.location.href);
      setShared(true);
      setError('');
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return;
      setError('Unable to share automatically. Copy this page’s address to share the profile.');
    }
  }
  return (
    <main className="public-profile">
      <header className="profile-toolbar">
        <a className="brand" href="/">
          <img src="/icon.svg" width="27" height="27" alt="" />
          <span>DROIDEX</span>
        </a>
        <button onClick={() => void share()}>
          {shared ? <Check size={17} /> : <Share2 size={17} />}{' '}
          {shared ? 'Shared' : 'Share profile'}
        </button>
      </header>
      <div className="profile-identity">
        <div className="avatar" aria-hidden="true">
          {initial}
        </div>
        <h1>{profile.displayName}</h1>
        <span className="username">@{profile.username}</span>
        <p className="muted">A little of what gets built.</p>
      </div>
      <ProfileStats profile={profile} />
      <Activity profile={profile} />
      <div className="profile-rankings">
        <Ranking title="Most used harnesses" values={profile.harnesses} />
        <Ranking title="Most used models" values={profile.models} />
      </div>
      <div className="profile-note">
        <ShieldCheck size={17} />
        <p>
          Username verified · snapshot from {new Date(profile.generatedAt).toLocaleDateString()}
          <br />
          Observed activity since {new Date(profile.trackingSince).toLocaleDateString()}. No chats,
          prompts, or workspace details.
          {!profile.tokensComplete && (
            <>
              <br />
              Some harness logs omit token counts, so measured totals are minimums.
            </>
          )}
        </p>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}

function ProfileStats({ profile }: { profile: PublicProfileSnapshot }) {
  const minimum = profile.tokensComplete ? '' : '≥ ';
  return (
    <dl className="profile-stats">
      <div>
        <dd>
          {minimum}
          {compact.format(profile.lifetimeTokens)}
        </dd>
        <dt>{profile.tokensComplete ? 'Lifetime tokens' : 'Measured tokens (minimum)'}</dt>
      </div>
      <div>
        <dd>
          {minimum}
          {compact.format(profile.peakDayTokens)}
        </dd>
        <dt>{profile.tokensComplete ? 'Peak observed day' : 'Peak measured day (minimum)'}</dt>
      </div>
      <div>
        <dd>{integer.format(profile.sessions)}</dd>
        <dt>Sessions</dt>
      </div>
      <div>
        <dd>
          {profile.currentStreak} {profile.currentStreak === 1 ? 'day' : 'days'}
        </dd>
        <dt>Current streak</dt>
      </div>
      <div>
        <dd>
          {profile.longestStreak} {profile.longestStreak === 1 ? 'day' : 'days'}
        </dd>
        <dt>Longest streak</dt>
      </div>
    </dl>
  );
}

function Ranking({
  title,
  values,
}: {
  title: string;
  values: { name: string; sessions: number }[];
}) {
  const maximum = Math.max(1, ...values.map((value) => value.sessions));
  return (
    <section className="ranking">
      <h2>{title}</h2>
      {values.length ? (
        values.slice(0, 5).map((value) => (
          <div className="ranking-row" key={value.name}>
            <div className="ranking-label">
              <strong>{value.name}</strong>
              <span className="muted">
                {integer.format(value.sessions)} {value.sessions === 1 ? 'session' : 'sessions'}
              </span>
            </div>
            <div className="ranking-track">
              <span style={{ width: `${String((value.sessions / maximum) * 100)}%` }} />
            </div>
          </div>
        ))
      ) : (
        <p className="muted">No sessions recorded yet.</p>
      )}
    </section>
  );
}

function Activity({ profile }: { profile: PublicProfileSnapshot }) {
  const [mode, setMode] = useState<'daily' | 'weekly' | 'cumulative'>('daily');
  const [selected, setSelected] = useState<number | null>(null);
  const points = useMemo(() => {
    if (mode === 'weekly') {
      const weeks = new Map<string, { tokens: number; complete: boolean }>();
      for (const day of profile.days) {
        const date = new Date(`${day.date}T12:00:00Z`);
        date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
        const key = date.toISOString().slice(0, 10);
        const current = weeks.get(key) ?? { tokens: 0, complete: true };
        weeks.set(key, {
          tokens: current.tokens + day.tokens,
          complete: current.complete && day.complete,
        });
      }
      return Array.from(weeks, ([date, value]) => ({ date, ...value }));
    }
    let total = 0;
    let complete = true;
    return profile.days.map((day) => {
      complete &&= day.complete;
      return {
        ...day,
        tokens: mode === 'cumulative' ? (total += day.tokens) : day.tokens,
        complete: mode === 'cumulative' ? complete : day.complete,
      };
    });
  }, [mode, profile.days]);
  const index = Math.min(selected ?? points.length - 1, points.length - 1);
  const point = points[index];
  const maximum = Math.max(1, ...points.map((value) => value.tokens));
  const line = points
    .map(
      (value, position) =>
        `${String((position / Math.max(1, points.length - 1)) * 600)},${String(130 - (value.tokens / maximum) * 110)}`,
    )
    .join(' ');
  return (
    <section className="activity">
      <div className="activity-heading">
        <h2>Token activity</h2>
        <div className="segmented" role="group" aria-label="Activity grouping">
          {(['daily', 'weekly', 'cumulative'] as const).map((value) => (
            <button
              key={value}
              className={value === mode ? 'selected' : ''}
              aria-pressed={value === mode}
              onClick={() => {
                setMode(value);
                setSelected(null);
              }}
            >
              {value[0].toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      </div>
      {points.length ? (
        <>
          <div className="activity-value">
            <strong>
              {point.complete ? '' : '≥ '}
              {integer.format(point.tokens)}
            </strong>
            <span className="muted">
              {`${mode === 'weekly' ? 'Week of ' : ''}${formatDate(point.date)}`} ·{' '}
              {point.complete ? 'tokens' : 'measured tokens (minimum)'}
            </span>
          </div>
          <svg
            className="activity-chart"
            viewBox="0 0 600 150"
            role="img"
            aria-label={`${mode} token activity`}
          >
            <line x1="0" y1="132" x2="600" y2="132" className="chart-baseline" />
            <polyline points={line} className="chart-line" />
            <circle
              cx={(index / Math.max(1, points.length - 1)) * 600}
              cy={130 - (point.tokens / maximum) * 110}
              r="4"
              className="chart-point"
            />
          </svg>
          <label className="sr-only" htmlFor="activity-day">
            Explore recorded activity
          </label>
          <input
            id="activity-day"
            className="activity-range"
            type="range"
            min="0"
            max={points.length - 1}
            value={Math.max(0, index)}
            onChange={(event) => {
              setSelected(Number(event.target.value));
            }}
            aria-valuetext={`${formatDate(point.date)}, ${integer.format(point.tokens)} tokens`}
          />
          <div className="activity-dates">
            <span>{formatDate(points[0].date)}</span>
            <span>{formatDate(points[points.length - 1].date)}</span>
          </div>
        </>
      ) : (
        <p className="muted">Activity appears as DROIDEX observes token usage.</p>
      )}
    </section>
  );
}
