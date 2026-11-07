import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { hasCliLogin } from './Environment.js';

export const DROID_PROFILE_SCOPE_PREFIX = 'session.droid-profile:';

// Each Alt profile is another Factory subscription, signed in through its own
// wrapper command that runs Droid with HOME set to its directory.
export const DROID_PROFILES = ['alt', 'alt2'] as const;
export type DroidProfile = (typeof DROID_PROFILES)[number];

const PROFILE_LOGINS: Record<
  DroidProfile,
  { label: string; command: string; homeName: string; homeEnv: string }
> = {
  alt: {
    label: 'Alt',
    command: 'droid-alt',
    homeName: '.droid-alt-home',
    homeEnv: 'DROIDEX_ALT_HOME',
  },
  alt2: {
    label: 'Alt 2',
    command: 'droid-alt2',
    homeName: '.droid-alt2-home',
    homeEnv: 'DROIDEX_ALT2_HOME',
  },
};

export function droidProfileLabel(profile: DroidProfile): string {
  return PROFILE_LOGINS[profile].label;
}

// Main's history scan and tools read this, so an unusable value disables the
// profile instead of failing Main. Execution reports it through droidHome. An
// app opened from the Dock inherits no shell variables, so a signed-in default
// home enables the profile without its environment variable.
function altDroidHome(profile: DroidProfile): string | undefined {
  const { homeEnv, homeName } = PROFILE_LOGINS[profile];
  const configured = process.env[homeEnv];
  if (configured) return isAbsolute(configured) ? configured : undefined;
  const detected = join(homedir(), homeName);
  return hasCliLogin(join(detected, '.factory')) ? detected : undefined;
}

/** The profiles a lead can start threads on: those whose home holds a login. */
export function enabledDroidProfiles(): DroidProfile[] {
  return DROID_PROFILES.filter((profile) => {
    const home = altDroidHome(profile);
    return home !== undefined && hasCliLogin(join(home, '.factory'));
  });
}

/** Each enabled Alt profile's Droid sessions directory, in profile order. */
export function altSessionRoots(): { profile: DroidProfile; root: string }[] {
  return DROID_PROFILES.flatMap((profile) => {
    const home = altDroidHome(profile);
    return home ? [{ profile, root: join(home, '.factory', 'sessions') }] : [];
  });
}

export function droidHome(profile?: DroidProfile): string {
  if (profile === undefined) return homedir();
  const { label, command, homeName, homeEnv } = PROFILE_LOGINS[profile];
  const configured = process.env[homeEnv];
  if (configured && !isAbsolute(configured))
    throw new Error(`${homeEnv} must be an absolute path.`);
  const home = altDroidHome(profile);
  if (!home)
    throw new Error(
      `${label} threads are disabled. Sign in with ${command} (~/${homeName}) or set ${homeEnv}.`,
    );
  if (!existsSync(home) || !hasCliLogin(join(home, '.factory')))
    throw new Error(
      `${label} login is missing. Sign in through your isolated ${command} command first.`,
    );
  assertSeparateLogin(profile, home, 'Main', homedir());
  for (const other of DROID_PROFILES) {
    const otherHome = other === profile ? undefined : altDroidHome(other);
    if (otherHome && existsSync(otherHome))
      assertSeparateLogin(profile, home, droidProfileLabel(other), otherHome);
  }
  return home;
}

// Two profiles on one login would spend one subscription while showing two.
function assertSeparateLogin(
  profile: DroidProfile,
  home: string,
  otherLabel: string,
  otherHome: string,
): void {
  const label = droidProfileLabel(profile);
  const factory = join(home, '.factory');
  const otherFactory = join(otherHome, '.factory');
  if (
    realpathSync(home) === realpathSync(otherHome) ||
    (existsSync(otherFactory) && realpathSync(factory) === realpathSync(otherFactory))
  )
    throw new Error(`The ${label} home must use a separate Factory login directory.`);
  for (const marker of ['auth.v2.key', 'auth.v2.loginkeychain']) {
    const own = join(factory, marker);
    const other = join(otherFactory, marker);
    if (existsSync(own) && existsSync(other) && realpathSync(own) === realpathSync(other))
      throw new Error(`The ${label} profile must not share ${otherLabel}’s authentication files.`);
  }
}
