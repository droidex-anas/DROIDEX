# Using DROIDEX

This is the day to day guide. For setup and installation see the
[README](../README.md). For how the app is built see
[architecture.md](architecture.md).

## Sessions and the sidebar

Every conversation is a session with its own workspace, model, and autonomy
level. The sidebar is how you keep many of them straight.

**Customize sidebar**, the filter-lines button above your workspaces, switches
between grouping by workspace and grouping by **Activity / status**. Activity
separates tasks that need attention, tasks that are working, conversations that
are ready, and work you have settled. Workspace rows show the same status
indicators.

The same menu controls ordering, how many tasks appear per group, and which
statuses are shown. **Last active** keeps resumed older chats near the top, and
it survives a restart.

Sidebar preferences and the most recent 1,000 settled task markers are saved per
local profile. Markers for hidden chats and for newer activity are cleaned up
automatically.

The bell filters to unread conversations. Selecting one clears that filter.

### Settling a task

Choose **Mark as settled** from a chat's action menu once you have reviewed a
result. The conversation stays available under **Settled** with a **Reopen
task** action, and new activity brings it back on its own.

Settling is an organizational action. It does not cancel or delete anything.
Running tasks, and tasks waiting on your approval or answer, cannot be settled.

## Watching an agent work

Tokens stream as they arrive. The streaming caret shows text is arriving, and
**Working** stays visible until the turn finishes, including during gaps between
tokens.

**Settings → Tool activity** controls how much detail appears inside tool runs:

| Density | What you see |
| --- | --- |
| Compact | Summaries only |
| Balanced | Expandable rows |
| Detailed | Full output |

At every density a completed turn keeps one **Worked** disclosure followed by
the final answer. Read output stays available inside that disclosure, and
compaction markers stay visible.

## Reviewing changes

Click a changed file to open Review with the diff DROIDEX captured at the time
of the change. The disclosure arrow beside it opens an inline preview.

When a file is edited repeatedly, Review shows the most recent captured change
and the line counts that match it. This can differ from what Git reports,
because Git shows the cumulative diff and Review shows what the agent actually
did in that step. Selecting a Review scope returns you to the live Git changes.

Path-only previews go through the workspace Files permissions. Paths and
symlinks that point outside the permitted folder are rejected.

## GitHub pull requests

For GitHub repositories, the Context panel shows pull requests, checks, and
review comments by way of the GitHub CLI.

If `gh` is missing or signed out, Context shows the recovery action. DROIDEX can
install `gh` through an existing Homebrew installation, and otherwise opens
GitHub's official installation page. Authentication always completes through the
GitHub CLI's own browser or device flow, and the Context popover keeps the
one-time code visible and copyable until `gh` confirms the account is connected.

### Pull requests in the sidebar

**Pull request** grouping, and the search button beside notifications, use the
pull requests DROIDEX detects for each chat's worktree, including chats you have
never opened. Discovery runs at startup and once a minute while the app is
visible, independently of whether the Context panel is open. The GitHub CLI must
be signed in.

A lookup stops waiting after 10 seconds. If the underlying operation is still
running, discovery skips that one worktree until it finishes and keeps
refreshing the others. Restarting the app clears a stuck call.

Each chat keeps its 10 most recently detected pull requests. At the 1,000 chat
metadata limit, opening a chat can displace an older automatically detected
entry. Names, pins, and hidden-chat markers take priority and are never
displaced.

Search linked pull requests by number, URL, title, or branch. Links survive
restarts and branch changes, and detected status refreshes on its own. Use a
full pull request URL to distinguish repositories that happen to use the same
number.

## Updates

DROIDEX checks its signed Sparkle feed for new versions. A blue download button
appears beside Settings only when a newer version is available. Clicking it
opens Sparkle's native update window, and nothing downloads or installs until
you approve it. You can also check manually from the DROIDEX menu.

Official macOS downloads and first-launch instructions are in the
[public releases repository](https://github.com/droidex-anas/droidex-releases).
The publishing flow is documented in [releasing.md](releasing.md).
