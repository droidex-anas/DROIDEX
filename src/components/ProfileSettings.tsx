import { Check, Copy, Lock, Pencil, RefreshCw, Share2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { HANDLE_PATTERN } from '../../packages/remote/src';
import { ProfileActivity } from '../features/profile/ProfileActivity';
import {
  encodeProfileSnapshot,
  type ProfileIdentity,
  type ProfileUsageSnapshot,
} from '../features/profile/profileShare';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const action =
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-elevated focus-visible:bg-droid-active disabled:opacity-50';

function errorMessage(cause: unknown, message: string) {
  return cause instanceof Error ? cause.message : message;
}

function profileInitials(profile: ProfileIdentity) {
  return (profile.displayName || profile.username || 'You')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function ProfileSettings({
  profile,
  onProfileChange,
  webClientUrl = 'https://droidex.vercel.app',
  usernameLocked,
}: {
  profile: ProfileIdentity;
  onProfileChange: (profile: ProfileIdentity) => Promise<unknown>;
  webClientUrl?: string;
  usernameLocked?: boolean;
}) {
  const [usage, setUsage] = useState<ProfileUsageSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);

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

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await onProfileChange({
        displayName: draft.displayName.trim(),
        username: draft.username.trim().toLowerCase(),
      });
      setEditing(false);
      setShareUrl('');
    } catch (cause) {
      setError(errorMessage(cause, 'Could not save your profile.'));
    } finally {
      setSaving(false);
    }
  };
  const share = () => {
    if (!usage) return;
    try {
      const fragment = encodeProfileSnapshot({
        ...usage,
        ...profile,
        version: 1,
        generatedAt: Date.now(),
      });
      setShareUrl(`${webClientUrl.replace(/\/$/, '')}/p#${fragment}`);
      setCopied(false);
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Could not create a profile link.'));
    }
  };

  return (
    <div className="mx-auto max-w-3xl pb-8">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-droid-text">Profile</h2>
        <div className="flex items-center gap-1">
          <span className="mr-2 inline-flex items-center gap-1.5 text-[11px] text-droid-text-muted">
            <Lock size={12} /> Private
          </span>
          <button
            className={action}
            onClick={() => {
              setDraft(profile);
              setEditing(true);
            }}
          >
            <Pencil size={13} /> Edit
          </button>
          <button className={action} disabled={!usage} onClick={share}>
            <Share2 size={13} /> Share
          </button>
        </div>
      </div>
      {editing ? (
        <form
          className="mx-auto mt-8 max-w-sm space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="block text-[12px] text-droid-text-secondary">
            Name
            <input
              autoFocus
              required
              maxLength={80}
              value={draft.displayName}
              onChange={(event) => {
                setDraft({ ...draft, displayName: event.target.value });
              }}
              className="mt-1.5 block min-h-11 w-full rounded-lg bg-droid-elevated px-3 text-[13px] text-droid-text focus:outline-none focus-visible:bg-droid-active"
            />
          </label>
          <label className="block text-[12px] text-droid-text-secondary">
            Username
            <input
              required
              pattern={HANDLE_PATTERN.source.replace('-]', '\\-]')}
              disabled={usernameLocked}
              minLength={3}
              maxLength={30}
              value={draft.username}
              onChange={(event) => {
                setDraft({ ...draft, username: event.target.value.toLowerCase() });
              }}
              className="mt-1.5 block min-h-11 w-full rounded-lg bg-droid-elevated px-3 text-[13px] text-droid-text focus:outline-none focus-visible:bg-droid-active"
            />
            <span className="mt-1.5 block text-[11px] text-droid-text-muted">
              {usernameLocked
                ? 'Your paired username is fixed. Reset pairing in Remote settings before changing it.'
                : 'Your public remote address. 3–30 lowercase letters, numbers or hyphens, starting with a letter.'}
            </span>
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={saving}
              className={action}
              onClick={() => {
                setEditing(false);
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className={`${action} bg-droid-elevated text-droid-text`}
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </form>
      ) : (
        <div className="py-10 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-droid-elevated text-2xl font-medium text-droid-text">
            {profileInitials(profile)}
          </div>
          <h1 className="text-2xl font-medium tracking-tight text-droid-text">
            {profile.displayName || 'Your profile'}
          </h1>
          <p className="mt-1.5 text-[13px] text-droid-text-muted">
            {profile.username
              ? `@${profile.username}`
              : 'Add your name and choose a username to get started.'}
          </p>
        </div>
      )}
      {shareUrl && (
        <div className="mb-6 rounded-xl bg-droid-elevated p-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-[13px] font-medium text-droid-text">Share this snapshot</h3>
            <button
              aria-label="Close sharing"
              className={action}
              onClick={() => {
                setShareUrl('');
              }}
            >
              <X size={14} />
            </button>
          </div>
          <p className="mb-3 text-[11px] leading-5 text-droid-text-muted">
            Anyone with this link can see your name, username, aggregate activity and model names.
            It contains a fixed snapshot; nothing is uploaded. Shared copies cannot be revoked.
          </p>
          <div className="flex gap-2">
            <input
              aria-label="Profile share link"
              readOnly
              value={shareUrl}
              onFocus={(event) => {
                event.target.select();
              }}
              className="min-w-0 flex-1 rounded-lg bg-droid-surface px-3 text-[12px] text-droid-text-secondary"
            />
            <button
              className={`${action} bg-droid-surface`}
              onClick={() => {
                void navigator.clipboard
                  .writeText(shareUrl)
                  .then(() => {
                    setCopied(true);
                  })
                  .catch(() => {
                    setError('Could not copy the link. Select it and copy manually.');
                  });
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mb-4 text-[12px] leading-5 text-droid-red">
          {error}
        </p>
      )}
      {loading && !usage && (
        <p role="status" className="py-12 text-center text-[12px] text-droid-text-muted">
          Reading your local activity…
        </p>
      )}
      {usage && (
        <>
          <ProfileMetrics usage={usage} />
          <ProfileActivity usage={usage} />
          <div className="mt-8 grid gap-6 sm:grid-cols-2">
            <Ranking title="Most used harnesses" rows={usage.harnesses} />
            <Ranking title="Most used models" rows={usage.models} />
          </div>
          <div className="mt-8 flex items-center justify-between gap-4">
            <p className="max-w-xl text-[11px] leading-5 text-droid-text-muted">
              Counts come from chats observed in DROIDEX, including retained history. Models are
              ranked by each chat’s latest known model. Unreported tokens and external CLI activity
              are excluded.
            </p>
            <button disabled={loading} className={action} onClick={() => void refresh()}>
              <RefreshCw size={13} />
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ProfileMetrics({ usage }: { usage: ProfileUsageSnapshot }) {
  const metrics = [
    [compact.format(usage.lifetimeTokens), 'Lifetime tokens'],
    [compact.format(usage.peakDayTokens), 'Peak observed day'],
    [usage.sessions.toLocaleString(), 'Chats counted'],
    [
      `${String(usage.currentStreak)} ${usage.currentStreak === 1 ? 'day' : 'days'}`,
      'Current streak',
    ],
    [
      `${String(usage.longestStreak)} ${usage.longestStreak === 1 ? 'day' : 'days'}`,
      'Longest streak',
    ],
  ];
  return (
    <div className="grid grid-cols-2 gap-y-5 rounded-xl bg-droid-surface px-4 py-5 sm:grid-cols-5">
      {metrics.map(([value, label]) => (
        <div key={label} className="text-center">
          <div className="text-[17px] font-medium tabular-nums text-droid-text">{value}</div>
          <div className="mt-1 text-[11px] text-droid-text-muted">{label}</div>
        </div>
      ))}
    </div>
  );
}

function Ranking({ title, rows }: { title: string; rows: { name: string; sessions: number }[] }) {
  const total = rows.reduce((sum, row) => sum + row.sessions, 0);
  return (
    <section>
      <h3 className="mb-3 text-[13px] font-medium text-droid-text">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[12px] text-droid-text-muted">No measured activity yet.</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.name}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
                <span className="truncate text-droid-text-secondary" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 tabular-nums text-droid-text-muted">
                  {row.sessions} {row.sessions === 1 ? 'chat' : 'chats'}
                </span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-droid-elevated">
                <div
                  className="h-full rounded-full bg-droid-text-muted/40"
                  style={{ width: `${String((row.sessions / total) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
