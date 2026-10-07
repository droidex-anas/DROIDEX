# Local Projects

A project is one conversation that can run others. Its main chat and the threads
it starts are normal top-level sessions, not harness subagents: each keeps its
own history, settings, transcript and runtime identity, and each can be opened,
steered and reviewed like any other chat.

Projects ships in beta. The Projects view says so under its title, with links to
the app's own feedback and bug report (the dialog `/feedback` and `/bug` open)
and to the maker's account on X. A one-time spotlight beside the sidebar's
Projects entry introduces the feature once the first-run welcome card is gone;
it is one of the sidebar's announcements (`src/lib/sidebarCards.ts`, id
`projects-beta`).

## Starting threads

A chat on Droid, Claude Code or Codex is given DROIDEX's in-app session tools.
Droid and Claude Code receive the `droidex-sessions` MCP server; Codex receives
the same tools as deferred dynamic tools in `droidex_sessions`. Ten run a
project: `thread_spawn`, `thread_send`, `thread_list`, `thread_read`,
`thread_configure`, `thread_stop`, `plan_set`, `project_done`, `todo_add` and
`todo_done`.
The other five are the [session tools](session-tools.md) for the chats in the
user's sidebar. A Codex chat started before these tools were added resumes
without them because Codex cannot add dynamic tools to an existing thread;
start a new Codex chat to use them. Asking a chat to run work in parallel is
enough; it has the tools to start the work itself.

`thread_spawn` takes a required `reportBack`. With `true` it starts a thread,
which reports back to the chat that started it. That chat becomes a project's
main chat once its first thread starts or it writes its first plan, and a spawn
that fails leaves no project behind. A side chat cannot become one: closing it
deletes it, so it would leave its threads nothing to report to. With `false` it
starts an ordinary sidebar chat that belongs to no project, reports nowhere and
wakes nobody; [Session tools](session-tools.md) describes that kind.

Starting a thread asks the user unless the chat runs at High, and one "Always
allow" covers only the kind of chat it was given for. The other thread tools
never ask: they read, retune or move text between conversations DROIDEX already
owns, and none of them can put a thread past the autonomy of the chat that
started it. The thread tools reach only the caller's own project: its main chat
reaches every thread, and a thread reaches only the threads it started.

A thread inherits the folder, harness, model, reasoning effort and autonomy of
the chat that started it unless the call names others, and it never runs with
more autonomy than that chat. A named model is resolved against the catalog the
composer offers, because a harness handed an id it does not know answers nothing
instead of failing. A harness can carry one model twice, such as the hosted
`glm-5.3-flash` beside the user's own key for it as `custom:glm-5.3-flash`, so a
name that fits both resolves to the model the chat is already running, and a
name that fits several others is refused with their ids rather than guessed. A
harness whose catalog DROIDEX has not read yet takes the name as given.

DROIDEX isolates threads on its own. When another thread of the project is
working in the same checkout, starting or queued there, or waiting on a question
it asked there, the next one gets its own worktree at
`<repo>/.worktrees/thread-<name>/<repo>` on a `thread/<name>` branch. When
nobody asked for that worktree and the checkout cannot carry one, such as a
folder that is not a Git repository with a commit, the thread shares the
checkout instead. `thread_spawn` can override this with `workspace`, name the
`branch` and `base`, or put a review thread in the checkout of a settled thread
with `workspaceOf`, so it reads the work where it was done.

**Projects** lists every local project with what it is doing. Opening a row
opens the conversation that leads it with its Threads panel already beside it;
the chevron opens the project inside the Projects view instead, where its plan,
threads and held state live. **New project** opens the new-chat screen in project
mode: the same composer, with its folder, worktree, harness, model and autonomy,
whose first message starts the project's main chat instead of an ordinary one.
On Codex the orb starts one by voice: its main chat opens on a turn that asks
for the goal, and the conversation opens on that chat. A project shows its main
chat's current name, so one started by voice is named from what was said.

## How a project works

A project started with **New project** gives its main chat a brief: settle the
goal before handing anything out, by asking the user what is unclear and reading
the code, and only then write the plan. A step is one concrete piece of work
whose finish the chat could recognise, such as "Port the payments client to v3"
rather than "look into payments", and a thread is started for a settled step,
never to explore an open question or to work out what the task is. The thread
cannot see the chat, so the prompt it is given carries the whole task: context,
the files or areas involved, and what done means. A chat that became a project
on its own has no such brief, but the description of `thread_spawn` asks it the
same way to investigate open questions itself and start only decided work.

## A thread's questions reach the chat that started it

When a thread asks its harness's own question, the one a person clicks an answer
to, DROIDEX routes it to the chat that started the thread, options intact, and
wakes that chat. That chat answers with `thread_send`'s `answers`, one per
question, which reach the waiting call at once instead of queueing behind the
question; a send without them is refused while the thread waits. The answers
name the question by the `questionId` its wake and `thread_read` give, and are
refused when the thread now waits on another question. The user can still
answer inside the thread, and whichever answer comes first wins. A held project
routes nothing: its threads wait for the user.

Permission requests are never routed. They stay with the user whatever the
project is doing.

## Steering a thread

`thread_send` reaches a working thread the way the user's Steer does: the
harness takes the message at its next step inside the running turn, with its
own steer on Droid, Claude Code and Codex alike, or right after that turn when
it cannot take it sooner. `delivery: 'now'` is Send now: DROIDEX
stops the running turn and the message runs next. `delivery: 'queue'` waits for
the turn to end. A stopped or idle thread queues the message through the
project's queue and waits for a runtime slot when capacity is full. When a
working thread's turn ends or is
stopped while the message is on its way, the send is refused rather than
starting a new turn a Stop meant to end, and the chat reads the thread and
sends again. The tool says whether the message was steered, sent now or queued,
with its queue position and wait reason when queued. A queued result means it has not
started yet. Continue a stopped or queued thread with `thread_send` instead of
spawning another. A spawn still creates a thread when its title matches a
stopped, idle or queued one, but names that existing thread and suggests
continuing it; title matching ignores case and a trailing number or `(retry)`.

## Recovering the project and keeping follow-ups

After compaction or a restart, `thread_list` returns every thread the caller can
control in one call: full id, title, owner id, state, wait reason, the first 160
characters of its latest reply and its queued message count. It also returns
runtime load (`live` and `limit`) and the lead's open to-dos. A main chat reaches
all other threads in its project; a thread lists only its direct children.
`thread_read` returns the same wait reason and runtime load with the full reply
readout. Both tools only observe: they never start or resume a runtime, even
when capacity is full, a thread is stopped or the project is held.

Every thread-id argument accepts the full id or a unique prefix of at least
eight characters within that scope, including `workspaceOf`, plan links and
`todo_add.after`. An ambiguous prefix fails with the matching titles and full
ids. Runtime calls and returned ids use the canonical `appSessionId`.

The lead records follow-ups with `todo_add({ text, after?, inMinutes? })`, then
removes a handled follow-up with `todo_done({ id })`. A project holds at most 40
open to-dos; text is 1–400 characters. `after` marks it due when that thread
reports. `inMinutes` is an integer from 1 to 1440 and persists an absolute due
time, so DROIDEX rearms the reminder after a restart once session history is
ready. If both triggers are present, the first one makes it due. With neither,
it stays in the open list until handled.

Every wake ends with the open to-dos, due ones first and marked `[DUE]`. A timed
reminder uses the same delivery path as a report: a busy lead receives it when
that path can deliver, a held project waits for Resume, and a full inbox retains
the due reminder until room opens. Each reminder queues once; it remains due
until `todo_done` removes it. Removing a to-do also drops its pending reminder;
a reminder already handed over may still arrive. Use these follow-ups instead
of polling `thread_read` in a loop. Reports may arrive during the lead's turn.

The project snapshot exposes open to-dos, runtime load, thread state (including
`queued`) and wait reasons for the Threads panel. Rendering these new fields is
a separate UI change.

## The plan

The main chat keeps a plan with `plan_set`: the steps it means to take,
optionally grouped under milestones, each one able to name the thread carrying
it. A chat that is not a project yet becomes one with its first plan, so it can
plan first and then start a thread for each step. `thread_spawn` takes the step
it carries, so starting the work is what links the step to its conversation. A
step with a thread shows that conversation's real state and its own last step,
so the plan reports what DROIDEX can see rather than what a model claimed. A
step without one shows only what the main chat said about it. The plan holds at
most 60 steps, is stored in the project ledger, and appears above the threads
wherever the project is read.

`plan_set` also takes a `title`: a few words for the goal, which name the
project and its main chat in place of the opening prompt. Once the goal is
achieved and no thread is working or starting, the main chat calls
`project_done` with what the project achieved. Projects then shows it as done,
with that outcome and how long the project took. Any work after that reopens
it: a new thread, a message to a thread, a thread starting a turn, or a plan
with a step of the main chat's own that is not done. A project records when it
started; one from before that shows its main chat's start.

## The Threads panel

The chat's utility panel has a **Threads** tab. It opens with a short greeting
that changes through the day, the project's name, and how long it has been
running or how long it took, with the outcome once it is done, or a line saying to resume the
project in Projects while it is held. Below them come the plan, headed by how
many of its steps are done, and the threads, grouped the way the sidebar's
Activity view groups chats: **Needs you**, **Working** and **Recent**. Each
heading carries its count and folds its section. Each row
carries the thread's own last step and how long ago it moved. The states come
from the signals the sidebar reads, a pending approval or question, the session
phase and the chat's activity digest, so the panel never claims something the
app cannot back up.

Opening a row shows that thread's conversation read-only, loading its history
first if this window has not, with **Open** to bring it into the main pane,
where the ordinary composer and Stop steer it. In the chat, a started thread
renders as an inline line with its live step that stays visible after the turn
folds, and opening it shows the thread in the Threads tab. A project's chat
reads like a group chat: a thread's report, question or message arrives as that
thread speaking, with its harness's mark as its face and its name and what it
did over the bubble, never in the user's bubble or the main chat's own prose.
A message from a chat outside the project stays a quiet notice. While the main
chat waits with its turn ended and threads of its own working, its last reply
says **Waiting for N threads** beside Copy and Fork, naming them on hover. A
chat started with `reportBack` false gets the same inline line without a step,
and opening it opens that chat in the main pane. In the Projects view, opening a
thread opens it in the main pane.

Opening a thread does not stop its siblings. The user's Stop on a thread
interrupts that thread and drops its queued messages, and cancels a thread it
is still starting, taking back any worktree already cut for it.

## Reports

A settled turn of a thread reports to the chat that started it however it ended:
an excerpt of its final primary reply, the error that failed it, that it was
stopped, or that it ended without a reply. A reply longer than 1,200 characters
is cut to its end, and the report says so. Thinking and tool output never enter
a report. `thread_read` gives that chat the rest: the thread's latest replies,
up to their last 8,192 characters each, the question it is waiting on and what
it is running as, so the chat can look again after a compaction or before
deciding a step is done. It returns the latest reply alone unless asked for
more. DROIDEX keeps up to ten replies for each of the eight settled threads
whose conversations moved most recently; an older thread keeps only its final
reply, and its whole conversation stays in its own transcript. A turn that ends
without a reply never erases the last real one, and the main chat's own replies
are not kept, because they go to the user.

`thread_configure` retunes a thread's model, reasoning effort and autonomy in
place, for the same reason a person reaches for the composer's own controls: a
quick back-and-forth does not need the effort the original work did. Its
autonomy stays at most that of the chat that started the thread, and applies at
once. A new model or effort is handed over and applies once the thread's
current turn ends, because that turn may be waiting on the chat that asked; a
change that fails is reported in the thread's own chat. The wake stays
a push, because a report is what the chat that started the thread acts on and
pulling one costs a whole extra turn. The **New project** brief also says that a
thread which reports nothing twice is not working, and to stop it and tell the
user rather than nudge it again.

Reports use the project delivery path and may reach a lead mid-turn. No model
polls or stays running to wait for another model. Permission requests always
need the user, never approval by another agent. A question can be answered by another
chat: a thread's by the chat that started it, and any sidebar chat's by a chat
that sends it answers with `session_send`.

## Holds and limits

**Holding a project** stops new automatic deliveries and launches, not turns
already handed to a provider. DROIDEX holds a project when the user stops or
closes its main chat, when that chat's turn fails, when a delivery cannot be
made or was caught mid-flight by a restart, when a question arrives at a full
inbox or the ledger cannot be saved, and when deliveries run far past the pace
real turns could produce: 60 within five minutes reads as threads talking in
circles rather than working. There is no wake allowance otherwise: a project
reports as often as its threads settle, for as long as the work runs. A hold
put on by the main chat's failed turn lifts by itself when that chat's next turn
succeeds, since the chat is working again.

A thread's report that finds the inbox full does not hold the project. It waits
on the thread and queues as soon as a delivery makes room; a newer report from
the same thread replaces it.

A project runs as many threads as its work needs, and there is no limit on the
number of projects. What keeps one from running away is the limit of three
levels of threads below the main chat, the approval a spawn needs below High,
and that hold on threads talking in circles. A project queues at most 64
messages, counting the ones a delivery has claimed. At most two Projects
delivery turns run at once across all projects; ordinary interactive sends keep
their existing behaviour. A delivered turn stopped on a question for its owner,
or on a permission request only the user can answer, runs nothing and does not
count while it waits. Once answered it carries on, so for a while the count can
pass two. A child agent's request counts as its parent's, so a parent that keeps
working while its child waits can also let one more turn run.

Threads share their owner's workspace unless the spawn asks for a worktree, or
DROIDEX gives one its own because another thread is already working in that
checkout. A thread's worktree outlives the thread: it holds that work on its own
branch, and removing it is the user's call, from the app's Worktrees settings.
Merging those branches back is the user's call too: DROIDEX opens the branch, it
does not integrate it. DROIDEX must remain running; it cannot wake a sleeping
computer.

## Not implemented

Automatic integration of thread branches and per-thread diff attribution are
not part of Projects yet. Review still uses the ordinary conversation and workspace
facilities; a shared checkout does not establish which agent authored each file
change.

## Delivery and recovery

The project ledger is local `projects.json` under the DROIDEX user-data
directory. Writes use an atomic replacement and private file permissions. No
count bounds the ledger, so replies are what keeps it in check: past 6 MiB, the
threads whose conversations moved longest ago, in any project, give up their
earlier replies and then their final one. `thread_read` on a thread that lost
its final reply this way says so rather than returning nothing. A ledger that
still passed 8 MiB would be refused, and every project held. Membership is
persisted before a new session receives its first task.

The wake queue writes its claim before dispatch. **Accepted** means the provider
acknowledged the prompt, not that the model finished. The concurrency slot stays
held until that turn settles, except while the turn waits on a question routed
to the chat that started it, or on the user's permission: it runs nothing then,
and holding the slot could keep that chat from ever being woken to answer, or
stop every other project's reports until the user comes back. Busy targets retain messages and
retry from lifecycle availability or runtime capacity events, not a timer.
Messages arriving during admission stay queued independently of that claim.

Automatic runtime opens and resumes share a limit of 12, including opens still
in flight. Queued spawns keep their original task, checkout reservation and
position in the ledger; checkout instructions are added only when launching.
They start when capacity opens, after resumes that can be admitted. A resume
blocked by its own project's delivery does not hold up other projects' spawns.
Reports and due reminders can steer into a busy owner's turn without starting a
competing turn. Stop waits for admissions, independently of report consumption;
the provider's acknowledgement settles an in-flight report even if Stop races
it. Interrupted threads receive one restart continuation only when they have no
instruction already queued, including when the inbox is full.

A delivery the runtime could not take holds the project with its claim retained
as uncertain. One withdrawn before any turn was dispatched, by a Stop, a hold or
a question its thread stopped asking, holds nothing: its messages go back to the
queue, less the withdrawn question. After a restart, a project whose delivery was caught mid-flight is
held the same way; the others carry on, delivering what the restart left queued
once session history has loaded. No delivery goes out before that, because until
then a thread reads as an unknown session. Projects shows a held project with a
Resume control, and the Threads panel says to resume it there. Resuming discards
an uncertain claim **without resending it**; automatic replay could duplicate
work and is deliberately forbidden.

When the user stops or closes a project's main chat, the project is held too.
That chat's own next `thread_spawn` with `reportBack` true resumes it, the way
Resume in Projects does, because the chat is working again. Only a hold the Stop
alone put on is lifted this way: a hold from threads talking in circles, from an
uncertain delivery or from a failure other than the main chat's own turn stays
until the user resumes the project in Projects, and a spawn that was already under way when the user pressed Stop
is refused. So is a chat's first spawn, though no project exists yet for the
Stop to hold.

Malformed ledgers fail visibly and are left untouched. A ledger without `todos`
loads with an empty list; a thread without `queuedSpawn` has no queued launch.
If a to-do's `after` thread has left the project, only that link is removed; the
note and any time trigger remain.

## Ownership in code

`ProjectService` owns the project graph: membership, plans, durable to-dos, their
next-due timer, holds and the thread
tools that act on them. `ProjectTurns` reads each settled turn of a project
conversation, routes a thread's question to the chat that started it and writes
the bounded report. `ProjectActivity` keeps a bounded final reply and the last
error of a turn, opening the turn on the streaming flag or the first event the
model generates, because a reply that opened no turn would be reported as
silence. `ProjectWakeQueue` owns claims, admission, cancellation and turn slots.
`SpawnedChats` holds the two in-memory limits on chats started with `reportBack`
false. `ProjectSessions` correlates ordinary session creation and uses the
existing scheduling receipt; `SessionLifecycle` remains the only runtime owner.
There is no second session registry and no Projects SDK dependency.

The renderer keeps the projects snapshot once in its app store, validated at the
bridge boundary, so the sidebar, the navigation and Projects read one copy. A
thread row reads the activity digest of the threads it shows and no other
transcript. The existing chat and composer are reused rather than reimplemented.
