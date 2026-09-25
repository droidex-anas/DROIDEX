# Local Projects

A project is one conversation that can run others. Its main chat and the threads
it starts are normal top-level sessions, not harness subagents: each keeps its
own history, settings, transcript and runtime identity, and each can be opened,
steered and reviewed like any other chat.

## Starting threads

A chat on Droid or Claude Code is given DROIDEX's in-app MCP server,
`droidex-sessions`. Six of its tools run a project: `thread_spawn`,
`thread_send`, `thread_read`, `thread_configure`, `thread_stop` and `plan_set`.
The other five are the [session tools](session-tools.md) for the chats in the
user's sidebar. The Codex runtime does not connect to DROIDEX's in-app servers,
so a Codex chat has none of these tools and cannot start threads, though a
thread can run on Codex when the chat that starts it names that harness. Asking
a chat to run work in parallel is enough; it has the tools to start the work
itself.

`thread_spawn` takes a required `reportBack`. With `true` it starts a thread,
which reports back to the chat that started it. That chat becomes a project's
main chat once its first thread starts or it writes its first plan, and a spawn
that fails leaves no project behind. With `false` it starts an ordinary sidebar
chat that belongs to no project, reports nowhere and wakes nobody; [Session
tools](session-tools.md) describes that kind.

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
working in the same checkout, still starting there, or waiting on a question it
asked there, the next one gets its own worktree at
`<repo>/.worktrees/thread-<name>/<repo>` on a `thread/<name>` branch. When
nobody asked for that worktree and the checkout cannot carry one, such as a
folder that is not a Git repository with a commit, the thread shares the
checkout instead. `thread_spawn` can override this with `workspace`, name the
`branch` and `base`, or put a review thread in the checkout of a settled thread
with `workspaceOf`, so it reads the work where it was done.

**Projects** lists every local project with what it is doing. Opening a row
opens the conversation that leads it with its Threads panel already beside it;
the chevron opens the project inside the Projects view instead, where its plan,
threads and held state live. **New project** starts one from a goal and is the
only place that asks for a harness, model and autonomy.

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
question; a send without them is refused while the thread waits. The user can
still answer inside the thread, and whichever answer comes first wins. A held
project routes nothing: its threads wait for the user.

Permission requests are never routed. They stay with the user whatever the
project is doing.

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

## The Threads panel

The chat's utility panel has a **Threads** tab. It opens with a short greeting
that changes through the day and a line counting the threads that need the user,
are working or are idle, or saying to resume the project in Projects while it is
held. Below them come the plan and the threads, grouped the way the sidebar's
Activity view groups chats: **Needs you**, **Working** and **Recent**. Each row
carries the thread's own last step and how long ago it moved. The states come
from the signals the sidebar reads, a pending approval or question, the session
phase and the chat's activity digest, so the panel never claims something the
app cannot back up.

Opening a row shows that thread's conversation read-only, loading its history
first if this window has not, with **Open** to bring it into the main pane,
where the ordinary composer and Stop steer it. In the chat, a started thread
renders as an inline line with its live step that stays visible after the turn
folds, and opening it shows the thread in the Threads tab. A thread's report
arrives as a quiet notice rather than a message wearing the user's bubble. A
chat started with `reportBack` false gets the same inline line without a step,
and opening it opens that chat in the main pane. In the Projects view, opening a
thread opens it in the main pane.

Opening a thread does not stop its siblings. The user's Stop on a thread
interrupts that thread and drops its queued messages.

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
autonomy stays at most that of the chat that started the thread. The wake stays
a push, because a report is what the chat that started the thread acts on and
pulling one costs a whole extra turn. The **New project** brief also says that a
thread which reports nothing twice is not working, and to stop it and tell the
user rather than nudge it again.

A chat receives an ordinary new turn when it becomes available; no model polls
or stays running to wait for another model. Permission requests always need the
user, never approval by another agent. A question can be answered by another
chat: a thread's by the chat that started it, and any sidebar chat's by a chat
that sends it answers with `session_send`.

## Holds and limits

**Holding a project** stops new automatic deliveries and launches, not turns
already handed to a provider. DROIDEX holds a project when the user stops or
closes its main chat, when that chat's turn fails, when a delivery cannot be
made or was caught mid-flight by a restart, when a report or question arrives at
a full inbox or the ledger cannot be saved, and when deliveries run far past the
pace real turns could produce: 60 within five minutes reads as threads talking
in circles rather than working. There is no wake allowance otherwise: a project
reports as often as its threads settle, for as long as the work runs.

A project runs as many threads as its work needs, and there is no limit on the
number of projects. What keeps one from running away is the limit of three
levels of threads below the main chat, the approval a spawn needs below High,
and that hold on threads talking in circles. A project queues at most 64
messages, counting the ones a delivery has claimed. At most two Projects
delivery turns run at once across all projects; ordinary interactive sends keep
their existing behaviour.

Threads share their owner's workspace unless the spawn asks for a worktree, or
DROIDEX gives one its own because another thread is already working in that
checkout. A thread's worktree outlives the thread: it holds that work on its own
branch, and removing it is the user's call, from the app's Worktrees settings.
Merging those branches back is the user's call too: DROIDEX opens the branch, it
does not integrate it. DROIDEX must remain running; it cannot wake a sleeping
computer.

## Not implemented

Automatic integration of thread branches and per-thread diff attribution remain
outside this draft. Review still uses the ordinary conversation and workspace
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
to the chat that started it: it runs nothing then, and holding the slot could
keep that chat from ever being woken to answer. Busy targets retain messages and
retry from lifecycle availability or runtime capacity events, not a timer.
Messages arriving during admission stay queued independently of that claim.

A delivery the runtime could not take holds the project with its claim retained
as uncertain. After a restart, a project whose delivery was caught mid-flight is
held the same way; the others carry on. Projects shows a held project with a
Resume control, and the Threads panel says to resume it there. Resuming discards
an uncertain claim **without resending it**; automatic replay could duplicate
work and is deliberately forbidden.

When the user stops or closes a project's main chat, the project is held too.
That chat's own next `thread_spawn` with `reportBack` true resumes it, the way
Resume in Projects does, because the chat is working again. Only a hold the Stop
alone put on is lifted this way: a hold from a failure, from threads talking in
circles or from an uncertain delivery stays until the user resumes the project
in Projects, and a spawn that was already under way when the user pressed Stop
is refused. So is a chat's first spawn, though no project exists yet for the
Stop to hold.

Malformed or incompatible experimental ledgers fail visibly and are left
untouched. This draft provides no migration from earlier prototypes. Back up any
existing experimental `projects.json` before trying a changed draft.

## Ownership in code

`ProjectService` owns the project graph: membership, plans, holds and the thread
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
