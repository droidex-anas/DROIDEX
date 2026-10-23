import { useEffect, useState } from 'react';
import { HANDLE_PATTERN } from '../../../packages/remote/src';
import {
  encodeProfilePayload,
  verifyPublishedProfile,
  type DecodedPublishedProfile,
  type PublicProfileSnapshot,
} from './profileShare';

type Mutation = 'publish' | 'update' | 'unpublish';
interface Lookup {
  username: string;
  state: 'unknown' | 'checking' | 'known';
}

function errorMessage(cause: unknown, message: string) {
  return cause instanceof Error ? cause.message : message;
}

function desktopApi() {
  const api = window.droidex;
  if (!api) throw new Error('Profile publishing is available in the desktop app.');
  return api;
}

async function readPublishedProfile(username: string): Promise<DecodedPublishedProfile | null> {
  const value = await desktopApi().getPublishedProfile();
  if (!value) return null;
  const published = await verifyPublishedProfile(value, username);
  if (!published) throw new Error('The published profile could not be verified. Publish it again.');
  return published;
}

/**
 * The verified public profile for `username`: looked up whenever the username
 * or Remote readiness changes, and published, updated or revoked on request.
 * `known` is true only once the relay has answered for this username, so an
 * absent publication is never mistaken for "not published".
 */
export function useProfilePublication(username: string, publishingReady: boolean) {
  const [publication, setPublication] = useState<DecodedPublishedProfile | null>(null);
  const [lookup, setLookup] = useState<Lookup>({ username: '', state: 'unknown' });
  const [error, setError] = useState('');
  const [mutation, setMutation] = useState<Mutation | null>(null);

  useEffect(() => {
    let active = true;
    setError('');
    if (!publishingReady || !HANDLE_PATTERN.test(username)) {
      setLookup({ username, state: 'unknown' });
      return () => {
        active = false;
      };
    }
    setLookup({ username, state: 'checking' });
    void readPublishedProfile(username)
      .then((value) => {
        if (!active) return;
        setPublication(value);
        setLookup({ username, state: 'known' });
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setLookup({ username, state: 'unknown' });
        setError(errorMessage(cause, 'Could not check your public profile.'));
      });
    return () => {
      active = false;
    };
  }, [username, publishingReady]);

  const current = publication?.profile.username === username ? publication : null;
  const known = lookup.username === username && lookup.state === 'known';
  const checking = lookup.username === username && lookup.state === 'checking';

  const refetch = async () => {
    setLookup({ username, state: 'checking' });
    try {
      setPublication(await readPublishedProfile(username));
      setLookup({ username, state: 'known' });
    } catch {
      // Keep the last verified publication visible if the conflict refresh fails.
      setLookup({ username, state: 'unknown' });
    }
  };

  const mutate = async (next: Mutation, action: () => Promise<void>, failure: string) => {
    setMutation(next);
    setError('');
    try {
      await action();
      return true;
    } catch (cause) {
      const message = errorMessage(cause, failure);
      setError(message);
      if (/public profile changed/i.test(message)) await refetch();
      return false;
    } finally {
      setMutation(null);
    }
  };

  const publish = (snapshot: PublicProfileSnapshot) => {
    if (!publishingReady || (!current && !known)) return Promise.resolve(false);
    return mutate(
      current ? 'update' : 'publish',
      async () => {
        const next = await desktopApi().publishPublicProfile(encodeProfilePayload(snapshot));
        const verified = await verifyPublishedProfile(next, username);
        if (!verified) throw new Error('The published profile could not be verified.');
        setPublication(verified);
        setLookup({ username, state: 'known' });
      },
      'Could not publish your profile.',
    );
  };

  const unpublish = () => {
    if (!current) return Promise.resolve(false);
    return mutate(
      'unpublish',
      async () => {
        await desktopApi().revokePublicProfile(current.payload);
        setPublication(null);
        setLookup({ username, state: 'known' });
      },
      'Could not unpublish your profile.',
    );
  };

  return { publication: current, known, checking, error, mutation, publish, unpublish };
}
