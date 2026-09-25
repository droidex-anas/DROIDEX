# Session tools

A chat on Droid or Claude Code is given DROIDEX's in-app MCP server,
`droidex-sessions`, which carries all eleven tools on one listener per session.
Unattended automation runs never get it, and nothing in it runs until a tool is
called.

| Tool | What it does | Below High | One Always allow covers |
| --- | --- | --- | --- |
| `thread_spawn` | Starts a chat that carries one task; `reportBack` is required | asks | one kind: threads or chats |
| `thread_send` | Sends one of this chat's threads a message, or `answers` to its question | runs | never asks |
| `thread_read` | Reads a thread: its latest replies (the last 8,192 characters of each), its question, its settings | runs | never asks |
| `thread_configure` | Changes a thread's model, reasoning effort or autonomy | runs | never asks |
| `thread_stop` | Ends a thread's turn and drops its queued messages | runs | never asks |
| `plan_set` | Writes the plan the chat shows in Projects | runs | never asks |
| `session_list` | Lists the sidebar's chats, most urgent first; `show` narrows it, `limit` caps it (30, at most 100) | runs | never asks |
| `session_read` | Reads one chat: its status, the approval or questions it waits on word for word, its settings, the last 4,000 characters of its latest reply | runs | never asks |
| `session_send` | Sends one chat a message, or `answers` to its question | asks | that one chat |
| `session_stop` | Stops the turn one chat is running and drops its queued messages | asks | that one chat |
| `session_mark` | Settles, reopens or archives up to 20 chats | asks | that mark on exactly those chats |

Every tool runs without asking at High. Claude Code at High bypasses its
permissions entirely, so each tool checks its own refusals whatever the
approval. A call missing the input its grant is scoped by cannot be allowed
always. DROIDEX keeps a grant in memory for the chat that was given it until its
runtime closes, and never hands Claude Code a narrower grant as a rule for the
whole tool.

## reportBack

With `reportBack: true`, `thread_spawn` starts a thread of the calling chat, in
its project or a new one, down to three levels below the main chat, as
[Projects](projects.md) describes. The other thread tools reach only that
project, and a thread reaches only the threads it started.

With `reportBack: false` it starts an ordinary sidebar chat that belongs to no
project, reports nowhere and wakes nobody; the thread tools refuse it, and the
chat that started it follows it with the session tools. Its opening brief names
that chat and tells it to write for the user and ask the user its questions, and
until the user opens it, its first reply marks it Needs review. It shares the
caller's folder unless the call asks for `workspace: "worktree"`, and `step` and
`workspaceOf` are refused. Neither a project thread nor a chat started this way
can start one, and one chat has at most eight it started still working, counting
those starting. Both kinds inherit the caller's harness, model, reasoning effort
and autonomy unless the call names others, and neither runs above the caller's
autonomy. The user's Stop on the caller cancels a chat it is still starting.

## What the session tools read

Only an ordinary chat can call them, a project's main chat included. A project
thread, a mission or a design session is refused, and if Projects failed to load
they all fail, since threads could not be told apart from sidebar chats.

The window owns the sidebar. It reports each chat's title, its status and label
from the function the sidebar draws with, unread, pinned, on screen, its settle
marker, whether its pull requests are all closed, and the approval or question
it waits on. It covers every chat it has loaded for the sidebar, whatever the
view, filter or page size, and never an archived or deleted chat or a project
thread; an older session behind Show earlier is missing until the sidebar loads
it. The sidecar drops the caller and adds each chat's harness, folder, last
activity, queued messages and settings; for a main chat, its project, whether it
is held and how many threads wait on an approval or a question; and for
`session_read`, the end of the latest reply, folded from the newest 200 stored
transcript events by the rule thread reports use.

`session_list` puts the sidebar's Needs you group first, with main chats whose
threads are blocked, then Working, the rest and Settled, newest first in each;
`more` counts what `limit` cut.

## What they refuse

A target must be a chat the window just reported; otherwise the tool says only
that no sidebar chat has that id. `session_read`, `session_send` and
`session_stop` refuse a target that is not an ordinary chat, and the last two
refuse an automation run.

`session_send` is refused to a chat waiting on an approval or a plan, to one at
a higher autonomy than the caller, and past ten messages to one chat in five
minutes from any chats, because chats messaging each other in a loop would keep
it busy forever. A chat waiting on its own question needs answers, one per
question in order, and answers where no question waits are refused.

`session_stop` is refused to a chat waiting on the user, because an interrupt
would throw away the user's decision, and to one with no turn running. It is not
the user's Stop, so it never holds a project.

`session_mark` reports each chat as done or refused with a reason. The window
applies the sidebar's own rules as the change lands: a chat working or waiting
on the user is neither settled nor archived, one with activity newer than the
caller saw is not settled, only a settled chat reopens, one whose pull requests
are all closed stays settled, and the chat on screen is not archived. The
sidecar refuses to archive a project's main chat.

## Answers, permissions and delivery

Answering a question follows the managing chat's autonomy like any other send: a
card below High, none at High. The answers reach the waiting call at once, after
any words sent with them, so a failed delivery leaves the question open. The
answered chat's transcript names the chat that answered, and the window stops
showing the question. Permission requests stay with the user: no tool approves
or denies one, and `session_read` shows them word for word.

A message to a chat running a turn joins that chat's queue, as a prompt typed
during a turn does; otherwise it starts a turn, loading a released chat only
while fewer than eight are loaded. The tool never waits for the turn and reports
`started`, `queued`, `answered` or `already-answered`. The chat reads the
message as from another chat, never the user, and the window shows it as a
notice led by "Message from" and that chat's name.

## The window request

Each call sends an unbatched `sidebar.request`, for rows or for a mark with the
activity time the sidecar saw, and takes the first valid `sidebar.result` within
three seconds. The app root answers from one read of the store and the saved
sidebar preferences, so it works with the sidebar collapsed and nothing runs
between requests. When the window does not answer, during a reload say, the tool
fails rather than guess, and a failed mark says to check the sidebar. The window
neither answers nor acts in the last second before the sidecar stops waiting, so
it does not apply a change the tool already reported as failed.

## Codex

The Codex runtime does not connect to DROIDEX's in-app servers, so a Codex chat
has none of these tools. As a target it is like any other chat, and its
approvals and questions pass through the same interactions, so every status
means the same on each harness. `thread_spawn` can start a Codex chat of either
kind; a Codex thread still reports back and its questions still reach the chat
that started it, but it cannot start chats of its own.

## Known gaps

- Only the sidebar's Activity view works out Awaiting your reply and
  Uncommitted changes, so these tools call such a chat Recent and say so.
- The message loop brake and both limits on started chats live in memory and
  reset when DROIDEX restarts.
- DROIDEX still starts its in-app servers for a Codex session, which never
  connects to them.
- On Droid a card appears only when Droid asks DROIDEX, and an Always allow is
  passed on to Droid, which decides whether it stops asking for the whole tool.
