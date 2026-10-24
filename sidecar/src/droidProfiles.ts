import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { hasCliLogin } from './Environment.js';

export const DROID_PROFILE_SCOPE_PREFIX = 'session.droid-profile:';
const DEFAULT_ALT_HOME_NAME = '.droid-alt-home';

// Main's history scan and tools read this, so an unusable value disables Alt
// instead of failing Main. Alt execution reports it through droidHome. An app
// opened from the Dock inherits no shell variables, so a signed-in droid-alt
// home enables Alt without DROIDEX_ALT_HOME.
export function altDroidHome(): string | undefined {
  const configured = process.env.DROIDEX_ALT_HOME;
  if (configured) return isAbsolute(configured) ? configured : undefined;
  const detected = join(homedir(), DEFAULT_ALT_HOME_NAME);
  return hasCliLogin(join(detected, '.factory')) ? detected : undefined;
}

export function droidHome(profile?: 'alt'): string {
  if (profile === undefined) return homedir();
  const configured = process.env.DROIDEX_ALT_HOME;
  if (configured && !isAbsolute(configured))
    throw new Error('DROIDEX_ALT_HOME must be an absolute path.');
  const home = altDroidHome();
  if (!home)
    throw new Error(
      `Alt threads are disabled. Sign in with droid-alt (~/${DEFAULT_ALT_HOME_NAME}) or set DROIDEX_ALT_HOME.`,
    );
  const factory = join(home, '.factory');
  const mainFactory = join(homedir(), '.factory');
  if (!existsSync(home) || !hasCliLogin(factory))
    throw new Error('Alt login is missing. Sign in through your isolated droid-alt command first.');
  if (
    realpathSync(home) === realpathSync(homedir()) ||
    (existsSync(mainFactory) && realpathSync(factory) === realpathSync(mainFactory))
  )
    throw new Error('The Alt home must use a separate Factory login directory.');
  for (const marker of ['auth.v2.key', 'auth.v2.loginkeychain']) {
    const alt = join(factory, marker);
    const main = join(mainFactory, marker);
    if (existsSync(alt) && existsSync(main) && realpathSync(alt) === realpathSync(main))
      throw new Error('The Alt profile must not share Main’s authentication files.');
  }
  return home;
}
