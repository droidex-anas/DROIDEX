import { useEffect, useState, type ReactNode } from 'react';
import { RefreshCw, ShieldCheck } from '@droidex/icons';
import { HANDLE_PATTERN } from '../../packages/remote/src/profile';
import { Button } from '../../src/components/ui/Button';
import type { RemoteArtScene } from '../../src/features/remote/RemoteArt';
import { GateLayout, GateScreen } from './GateLayout';
import { GetDroidexButton, PublicProfilePage } from './PublicProfilePage';
import { loadPublishedProfile, type ProfileLoadResult } from './profileVerification';

const LOAD_TIMEOUT_MS = 8_000;

// Crawlers that don't run scripts still see index.html's generic title.
function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [title, description]);
}

function ProfileState({
  scene,
  title,
  line,
  children,
}: {
  scene: RemoteArtScene;
  title: string;
  line: string;
  children?: ReactNode;
}) {
  return (
    <GateLayout
      label="Profile"
      scene={scene}
      footer={
        <>
          <ShieldCheck className="size-icon-sm" aria-hidden="true" />
          Profiles are signed on their owner’s laptop
        </>
      }
    >
      <GateScreen title={title} line={line}>
        {children}
      </GateScreen>
    </GateLayout>
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
    }, LOAD_TIMEOUT_MS);
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

  let title = 'Profile not found · DROIDEX';
  let description = 'DROIDEX profiles show public usage stats signed on their owner’s laptop.';
  if (validUsername) {
    title = `@${username} on DROIDEX`;
    description = `@${username}’s public DROIDEX profile.`;
  }
  if (validUsername && result.status === 'verified') {
    title = `${result.profile.displayName} (@${username}) on DROIDEX`;
    description = `@${username}’s DROIDEX profile: tokens, streaks, and the harnesses and models they use.`;
  }
  usePageMeta(title, description);

  const retry = () => {
    setAttempt((value) => value + 1);
  };
  const getDroidex = <GetDroidexButton variant="primary" size="lg" className="w-full" />;

  if (!validUsername)
    return (
      <ProfileState
        scene="handle"
        title="This profile link isn’t valid"
        line="Check the username in the link, or ask its owner to share it again."
      >
        {getDroidex}
      </ProfileState>
    );
  if (result.status === 'loading')
    return (
      <ProfileState
        scene="waiting"
        title={`Loading @${username}`}
        line="Fetching the profile and checking its signature."
      />
    );
  if (result.status === 'not-published')
    return (
      <ProfileState
        scene="intro"
        title={`@${username} hasn’t shared a profile yet`}
        line="When they publish one, their activity, streaks and favourite tools show up here."
      >
        <div className="flex flex-col gap-2">
          {getDroidex}
          <Button size="lg" className="w-full" icon={RefreshCw} onClick={retry}>
            Check again
          </Button>
        </div>
        <p className="text-caption text-muted">
          Is this you? Publish it from DROIDEX → Settings → Profile → Share.
        </p>
      </ProfileState>
    );
  if (result.status === 'unavailable')
    return (
      <ProfileState
        scene="offline"
        title="Couldn’t load this profile"
        line="The profile service didn’t answer, or asked to slow down. Wait a moment and try again."
      >
        <Button variant="primary" size="lg" className="w-full" icon={RefreshCw} onClick={retry}>
          Try again
        </Button>
      </ProfileState>
    );
  if (result.status === 'unverified')
    return (
      <ProfileState
        scene="denied"
        title="This profile couldn’t be verified"
        line={`The published data doesn’t match @${username}’s signature, so it isn’t shown. Ask its owner to publish it again.`}
      >
        <Button size="lg" className="w-full" icon={RefreshCw} onClick={retry}>
          Try again
        </Button>
      </ProfileState>
    );
  return <PublicProfilePage profile={result.profile} />;
}
