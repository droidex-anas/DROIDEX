# Local Alt threads (private experiment)

This is an opt-in local experiment for DROIDEX project threads. It is not a
public account-switching feature and has no Settings control or release notice.
Factory's own desktop app and ordinary CLI login remain independent of it.

## Enable locally

First sign in through an existing isolated `droid-alt` setup. Then start DROIDEX
with the absolute home directory that setup uses:

```bash
DROIDEX_ALT_HOME="$HOME/.droid-alt-home" npm run electron
```

For a second development instance, also set a separate `DROIDEX_USER_DATA_DIR`
and `ELECTRON_START_URL` as described in the architecture runbook. The experiment
uses the same resolved Droid executable as Main, with the Alt process's `HOME`
pointing at this directory. It does not execute a shell alias or copy credentials.
The directory must contain its own `.factory` login; sharing Main's auth files
is refused. Keep this directory stable while its conversations exist.

## Delegate from Main

Tell the lead to use the Alt profile for its worker threads. With local opt-in,
the existing `thread_spawn` tool advertises an optional `profile` argument:

```json
{
  "title": "Implement settings",
  "prompt": "Implement the agreed settings change and report the checks.",
  "profile": "alt",
  "reportBack": true
}
```

The lead remains on Main. An omitted profile inherits the spawning Droid chat's
profile; `"main"` explicitly selects Main. Other harnesses refuse a Factory
profile. Alt requires an exact model ID available to that login, or inherits
the owner's model ID when omitted. A model missing from Alt fails before the
first task runs. Model availability comes from Alt's own session initialization;
it never replaces Main's model catalog.

## Continue directly on Alt

Open an Alt thread with its **Open** action to use the normal chat composer.
Follow-ups stay on Alt. That thread can spawn more reporting threads, which
inherit Alt when `profile` is omitted. They stay in the same project and report
to the thread that started them; nesting is limited to three levels below the
project lead.

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
project on Alt. A reporting thread must keep `reportBack: true` when it spawns
children. The account choice remains a tool-only experiment; there is no
account picker in the normal new-chat flow.

## What stays attached to the thread

Queued starts, follow-ups, runtime release, reopen, forks, compaction and native
Droid children keep the selected profile. Thread rows, spawn entries and the
thread header display **Alt**. The sidebar row and normal chat composer keep
the same account mark when opening the conversation directly. Each thread
streams into its existing independent transcript, with the usual stop, approval
and report controls. The sidebar and project relationships remain DROIDEX-owned.

Alt processes never receive Main's configured or inherited `FACTORY_API_KEY`.
Usage limits still fail on the affected thread and report to its owner. Alt's
`/usage` panel deliberately shows no numeric quota: use `/limits` in `droid-alt`
to inspect that subscription. Main's meters are never presented as Alt's.

Removing `DROIDEX_ALT_HOME` hides the Alt choice and disables Alt execution.
Saved Alt bindings remain in canonical history; reopening one fails with local
activation instructions rather than opening it under Main. There is no quota
rotation, cross-account provider-session migration or silent Main fallback.
