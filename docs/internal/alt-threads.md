# Local Alt threads (private experiment)

This is an opt-in local experiment for DROIDEX project threads. It is not a
public account-switching feature and has no Settings control or release notice.
Factory's own desktop app and ordinary CLI login remain independent of it.

## Enable locally

Each Alt profile is one extra Factory login with its own subscription quota:

| Profile | Label | Sign-in command | Default home | Override |
| --- | --- | --- | --- | --- |
| `alt` | Alt | `droid-alt` | `~/.droid-alt-home` | `DROIDEX_ALT_HOME` |
| `alt2` | Alt 2 | `droid-alt2` | `~/.droid-alt2-home` | `DROIDEX_ALT2_HOME` |

The sign-in command is your own script that runs Droid with `HOME` pointing at
the profile's home, for example:

```sh
#!/bin/sh
exec env HOME="$HOME/.droid-alt2-home" droid "$@"
```

Run it once and sign in with that account. When the home's `.factory` holds
the login, DROIDEX enables the profile by itself, including when it is opened
from the Dock. For another directory, start DROIDEX with its absolute path,
which takes precedence:

```bash
DROIDEX_ALT_HOME="$HOME/.droid-alt-home" DROIDEX_ALT2_HOME="$HOME/.droid-alt2-home" npm run electron
```

For a second development instance, also set a separate `DROIDEX_USER_DATA_DIR`
and `ELECTRON_START_URL` as described in the architecture runbook. The experiment
uses the same resolved Droid executable as Main, with the Alt process's `HOME`
pointing at the profile's directory. It does not execute a shell alias or copy
credentials. Each directory must contain its own `.factory` login; sharing
Main's or another Alt profile's login directory or auth files is refused. Keep
these directories stable while their conversations exist.

## Delegate from Main

Tell the lead which profile to use for its worker threads, or let it spread
work across them. With local opt-in, the existing `thread_spawn` tool
advertises an optional `profile` argument listing `main` and each signed-in
Alt profile:

```json
{
  "title": "Implement settings",
  "prompt": "Implement the agreed settings change and report the checks.",
  "profile": "alt2",
  "reportBack": true
}
```

The lead remains on Main. An omitted profile inherits the spawning Droid chat's
profile; `"main"` explicitly selects Main. Other harnesses refuse a Factory
profile. An Alt profile requires an exact model ID available to that login, or
inherits the owner's model ID when omitted. A model missing from the profile
fails before the first task runs. Model availability comes from the profile's
own session initialization; it never replaces Main's model catalog.

## Continue directly on Alt

Open an Alt thread with its **Open** action to use the normal chat composer.
Follow-ups stay on its profile. That thread can spawn more reporting threads,
which inherit its profile when `profile` is omitted. They stay in the same
project and report to the thread that started them; nesting is limited to three
levels below the project lead.

For an independent Alt conversation in the sidebar, ask the lead to use the
same tool with `reportBack: false`:

```json
{
  "title": "Alt workspace",
  "prompt": "Say hi and wait for my next request.",
  "provider": "droid",
  "profile": "alt",
  "modelId": "claude-opus-5-5",
  "reasoningEffort": "low",
  "reportBack": false
}
```

Continue in that chat and ask it to spawn reporting threads to lead its own
project on that profile. A reporting thread must keep `reportBack: true` when it
spawns children. The account choice remains a tool-only experiment; there is no
account picker in the normal new-chat flow.

## What stays attached to the thread

Queued starts, follow-ups, runtime release, reopen, forks, compaction and native
Droid children keep the selected profile. Thread rows, spawn entries and the
thread header display **Alt** or **Alt 2**. The sidebar row and normal chat
composer keep the same account mark when opening the conversation directly.
Each thread streams into its existing independent transcript, with the usual
stop, approval and report controls. The sidebar and project relationships
remain DROIDEX-owned.

Alt processes never receive Main's configured or inherited `FACTORY_API_KEY`.
Usage limits still fail on the affected thread and report to its owner. An Alt
profile's `/usage` panel deliberately shows no numeric quota: use `/limits` in
`droid-alt` or `droid-alt2` to inspect that subscription. Main's meters are
never presented as an Alt profile's.

Alt never breaks Main. An Alt transcript whose ID matches a Main chat, or a chat
of an earlier Alt profile, is ignored, including when the file watcher reports
a change to it. A relative `DROIDEX_ALT_HOME` or `DROIDEX_ALT2_HOME` disables
that profile instead of failing Main history: `thread_spawn` stops offering it,
and reopening one of its threads fails with the reason.

Without a signed-in default home or an override, the profile is hidden and its
execution is disabled. Saved Alt bindings remain in canonical history; reopening
one fails with local activation instructions rather than opening it under Main.
There is no quota rotation, cross-account provider-session migration or silent
Main fallback.

## Usage across accounts

While an Alt profile is signed in, the lead also gets a `factory_usage` tool. It
lists Main and each signed-in Alt profile with its Standard and Droid Core
windows (percent used and reset time), and what Droid does once that account's
Standard usage runs out: move its threads to a Droid Core model, spend its extra
usage balance, or refuse them until Standard resets. Every model spends Standard
first, so an account's Droid Core limits only come into play after that.

Each account is read with the credential its threads run on: Main with the
Factory API key from Settings when one is set, otherwise Main's Droid login, and
each Alt profile with its own login. DROIDEX decrypts a login the way Droid does,
with the key file beside it or the macOS Keychain entry Droid reads through
`security`, and never refreshes or writes it. An expired token is reported as
such until Droid next runs on that account.

When a harness moves a thread to another model by itself, such as Droid moving
it to Droid Core after Standard runs out, or back once Standard resets, the
report of that turn to the thread's owner starts with the switch.
