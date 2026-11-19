# Session tools

An ordinary chat on Droid, Claude Code or Codex is given DROIDEX's in-app
session tools, whether or not it belongs to a project. On Droid and Claude Code,
`droidex-sessions` carries all twenty-one tools on one listener per session. Codex
receives the same tools as deferred dynamic tools in the `droidex_sessions`
namespace, with no local MCP listener. Unattended automation runs, missions and
design sessions never get it, since none of them may call its tools, and nothing
in it runs until a tool is called.

| Tool | What it does | Below High | One Always allow covers |
| --- | --- | --- | --- |
| `thread_spawn` | Starts a chat that carries one task; `reportBack` is required | asks | one kind: threads or chats |
| `thread_send` | Sends instructions; `delivery` picks steer (default), interrupt or queue. Returns steered/started/resumed/queued/held/interrupt and the state after; queued includes position | runs | never asks |
| `thread_answer` | Answers the current `questionId` with one answer per question, in order; stale questions are refused and completion stays recorded | runs | never asks |
| `thread_approve` | Allows once or denies a controlled thread’s `requestId` within the caller’s autonomy; otherwise refuses and asks it to escalate to the user. Returns state after; optional note queues instructions; held projects must resume first | runs | never asks |
| `project_pause` | Lead only: holds new work, interrupts active threads and records their work for Resume; leaves the caller running and returns interrupted ids | runs | never asks |
| `project_resume` | Lead only: resumes the project, continues only work interrupted by Pause and drains retained reports; returns ids queued to continue; uncertain delivery requires user review in Projects | runs | never asks |
| `project_guide` | Returns the project lead playbook; read at the start and after compaction | runs | never asks |
| `project_read` | Recovers brief, milestone, lead-owned plan, decisions, open to-dos and unread/relevant threads; first call after restart or compaction, with no side effects | runs | never asks |
| `thread_list` | Lists active or failed controlled threads and unseen reports, plus a count of inactive threads; `all: true` lists every thread. Includes ids, owners, states, wait reasons, one-line reply previews, queued messages, runtime load and the lead’s open to-dos; observes even when full, stopped or held | runs | never asks |
| `todo_add` | Keeps a durable lead follow-up; `after` marks it due after the next report including failure or interruption, `inMinutes` schedules a reminder (1–1440), or `at` accepts a future ISO timestamp with timezone including multi-day reminders; at most 40 open, text 1–400; busy/full/held delivery follows reports | runs | never asks |
| `todo_done` | Removes an open lead follow-up and its queued reminder, even when full, stopped or held | runs | never asks |
| `thread_read` | Reads a thread: its latest bounded replies (the first 8,192 characters of each); `full: true` returns the latest settled final reply in full from its transcript, its question and its id, its settings, how many messages it has not been seen to take, whether a runtime is open, its wait reason and runtime load; never starts it | runs | never asks |
| `thread_configure` | Changes a thread's model, reasoning effort or autonomy | runs | never asks |
| `thread_stop` | Ends a thread's turn and drops its queued messages | runs | never asks |
| `plan_set` | Writes the plan the chat shows in Projects; `title` names the project and chat, `brief` records the agreed goal/scope/exclusions/done criteria/authority (≤2,000 characters). Stable step ids survive reordering; pass id when renaming. Lead owns planned/doing/review/done/blocked independently of thread state | runs | never asks |
| `project_done` | Marks the project done with what it achieved, refusing with an outstanding list of unread reports, open to-dos, failed/approval-waiting threads, pending messages and active work | runs | never asks |
| `session_list` | Lists the sidebar's chats, most urgent first; `show` narrows it, `limit` caps it (30, at most 100) | runs | never asks |
| `session_read` | Reads one chat: its status, the approval or questions it waits on word for word with the question's id, its settings, the last 4,000 characters of its latest reply | runs | never asks |
| `session_send` | Sends one chat a message, or `answers` to the question `questionId` names | asks | that one chat |
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
project, and a thread reaches only the threads it started. Thread-id arguments
accept a full id or a unique prefix of at least eight characters in that scope.
Ambiguous prefixes list matching titles and full ids. A full runtime pool queues
project work; the tool returns its position instead of promising an immediate
start. Continue a stopped, idle or queued thread with `thread_send`.

Only the lead owns project to-dos. They persist in the project ledger; scheduled
ones rearm after restart, and every project wake includes the open list before its messages, due
ones first. A due reminder waits in a full inbox or held project rather than
being lost. Call `project_read` first after compaction or restart and use to-dos for
follow-ups instead of polling `thread_read`.

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
it busy forever. Both chats' autonomy is read again as the message or the
answers reach the chat, and while its delivery waits to start, so lowering the
caller or raising the target during the call still refuses it. A chat waiting on its own question needs answers, one per
question in order, and answers where no question waits are refused. Answers
carry the `questionId` that `session_read` gave, and are refused when the chat
now waits on a different question, so answers written for a question the user
already settled never land on the next one.

`session_stop` is refused to a chat waiting on the user, because an interrupt
would throw away the user's decision, and to one with no turn running. It checks
DROIDEX's own record of pending approvals and questions at the moment it
interrupts, so one that arrived after the window last reported the chat stays
with the user. It is not the user's Stop, so it never holds a project.

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
showing the question. Sidebar-chat permission requests stay with the user, and
`session_read` shows them word for word. Within a project, `thread_approve` can
decide a request only within the lead’s own authority; it never raises autonomy
or bypasses a sandbox.

A message to a chat running a turn reaches it as the user's Steer does: the
harness takes it in at its own next step, and one the turn cannot take waits
behind it. Until then the chat lists it as an unread steer the user can send
now. Otherwise it starts a turn, loading a released chat only while fewer than
eight are loaded. The tool never waits for the turn and reports `started`,
`steered`, `answered` or `already-answered`. The chat reads the message as from
another chat, never the user, and once taken in the window shows it as a notice
led by "Message from" and that chat's name.

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

Codex declares the session and automation tools in the deferred
`droidex_sessions` and `droidex_automations` namespaces when a new thread starts.
It loads a tool when needed, calls DROIDEX's handler, and follows the same
approval and Always allow rules as Droid and Claude Code. Typed and spoken turns
share the thread and its tools. Codex restores the declarations on resume, but
cannot add them to a thread started before this feature; that chat keeps working
without in-app tools. Start a new Codex chat to use them.

## Known gaps

- Only the sidebar's Activity view works out Awaiting your reply and
  Uncommitted changes, so these tools call such a chat Recent and say so.
- The message loop brake and both limits on started chats live in memory and
  reset when DROIDEX restarts.
- On Droid a card appears only when Droid asks DROIDEX, and an Always allow is
  passed on to Droid, which decides whether it stops asking for the whole tool.
