# Local Projects

A project is one conversation that can run others. Its main conversation and
the threads it spawns are normal top-level sessions, not harness subagents:
each keeps its own history, settings, transcript and runtime identity, and each
can be opened, steered and reviewed like any other chat.

## Starting threads

A chat on a harness that runs DROIDEX's in-app tools can start other chats: it
is given the `droidex-sessions` MCP server with `thread_spawn`, `thread_send`,
`thread_stop`, `plan_set`, `thread_read` and `thread_configure`. That is Droid
and Claude Code today. The Codex runtime has no MCP path at all, so a Codex chat
sees none of DROIDEX's in-app tools and cannot lead a project; what a chat
starts can still run on any harness it names. Asking a chat to run work in
parallel is enough: it starts the work itself.

`thread_spawn` takes a required `reportBack`. With `true` it starts a thread,
which reports back to the chat that started it, and that chat becomes a
project's main conversation once its first thread starts or it writes its first
plan. A spawn that fails leaves no project behind. With `false` it starts an
ordinary chat in the user's sidebar that belongs to no project, reports nowhere
and wakes nobody, and the thread tools do not reach it. It opens with a brief
telling it that the user follows it in the sidebar. A chat started this way
cannot start chats of its own, a project thread cannot start one, and one chat
has at most eight chats it started working at once. DROIDEX keeps those two
limits in memory, so they reset when it restarts. Such a chat shares the folder
of the chat that started it unless the spawn asks for `workspace: "worktree"`.

`thread_spawn` follows the chat's own autonomy: it is auto-approved at High and
asks the user otherwise, and an "Always allow" covers only the kind of chat it
was given for. The rest only read, retune or move text between conversations
DROIDEX already owns, and none of them can put a thread past the autonomy its
owner has.

A thread inherits the workspace, harness, model, reasoning level and autonomy
of the chat that spawned it unless the call names different ones, and it can
never exceed its owner's autonomy. A named model is resolved against the same
catalog the composer offers, because a harness handed an id it does not know
answers nothing instead of failing. A harness can carry one model twice — the
hosted `glm-5.3-flash` beside the user's own key for it as
`custom:glm-5.3-flash` — so a name that fits both resolves to the model the
chat is already running, and a name that fits several others is refused with
their ids rather than guessed. DROIDEX isolates a thread on its own: a checkout that already has a thread
working in it gives the next one its own worktree,
`<repo>/.worktrees/<branch>/<repo>` on a `thread/` branch. `thread_spawn` can
override that with `workspace`, name the `branch` and `base`, or put a thread in
the checkout another thread used with `workspaceOf` — how a review thread reads
the work where it was done.

**Projects** lists every local project with what it is doing. Opening a row
opens the conversation that leads it with its Threads panel already beside it;
the chevron opens the project inside the Projects view instead, where its plan,
threads and held state live. **New project** starts one from a goal and is the
only place that asks for a harness, model and autonomy.

## How a project works

The lead settles the goal before it hands anything out: it asks the user what is
unclear, reads the code itself, and only then writes the plan. A step is one
concrete piece of work whose finish it could recognise — "Port the payments
client to v3", not "look into payments" — and a thread is started for a settled
step, never to explore an open question or to work out what the task is. The
thread cannot see the chat, so the prompt it is given carries the whole task:
context, the files or areas involved, and what done means.

## A thread's questions reach its lead

When a thread asks its harness's own question — the one a person clicks an
answer to — DROIDEX routes it to the conversation that started it, options
intact, and wakes that chat. The lead answers with `thread_send`'s `answers`,
one per question, which reaches the waiting call directly instead of queueing
behind the question that is blocking the thread; a send without them is refused
while a thread waits, because it would queue behind that question. The human can still answer it inside the thread;
whoever answers first wins and the other side stops asking. A paused project
routes nothing: its threads wait for the user.

Permission requests are never routed. They stay with the person, whatever the
project is doing.

## The plan

The lead keeps a plan with `plan_set`: the steps it means to take, optionally
grouped under milestones, each one able to name the thread carrying it. A chat
that is not a project yet becomes one with its first plan, so it can plan first
and then spawn a thread for each step.
`thread_spawn` takes the step it carries, so starting the work is what links the
row to its conversation. A step
with a thread shows that conversation's real state and its own last step, so the
table reports what DROIDEX can see rather than what a model claimed. A step
without one shows only what the lead said about it. The plan is stored in the
project ledger and appears above the threads wherever the project is read.

## The Threads panel

The chat's utility panel has a **Threads** tab: a headline stating what is
waiting on the user, then the chat's threads grouped **Needs you**, **Working**
and **Idle**, each row carrying the thread's own last step and how long ago it
moved. The states come from the same signals the sidebar's activity view reads
— a pending approval or question, the session phase, the chat's activity digest
— so the panel never claims something the app cannot back up.

Opening a row shows that thread's own conversation with a composer that steers
it in place, **Stop** while it runs, and **Open** to bring it into the main
pane. In the chat, a spawned thread renders as an inline row with its live step
that stays visible after the turn folds, and a thread's report back arrives as
a quiet notice rather than a message wearing the user's bubble. A chat started
with `reportBack` false gets the same inline row without a step, and opening it
opens that chat in the main pane.

Opening or selecting a thread does not stop its siblings. **Stop** interrupts
that thread and cancels its queued work.

A settled managed turn reports to its direct owner however it ended: a bounded
excerpt of its final primary reply, the error that failed it, that it was
stopped, or that it ended without a reply. The report is an excerpt and says so
when it is one. `thread_read` gives the owner the whole reply, the question the
thread is waiting on, and what it is running as, so a lead can look again —
after a compaction, or before deciding a step is done — instead of acting on
what it happened to be handed. It answers with the thread's latest reply alone
unless the lead asks for more. DROIDEX keeps the last ten for the eight settled
threads whose conversations moved most recently, so an owner that lost the
thread of a conversation can read as far back as it needs and no further; an
older thread keeps only its final reply, and its whole conversation stays in its
own transcript. A turn that ends without a reply never erases the last real one. `thread_configure` retunes a thread's model,
reasoning effort and autonomy in place, for the same reason a person reaches for
the composer's own controls: a quick back-and-forth does not need the effort the
original work did. The wake stays a push, because a report is the thing the
lead exists to act on and pulling one costs a whole extra turn to fetch a few
hundred characters. Tool output and thinking never enter
that report. A thread that reports nothing twice is not working, and the lead is
briefed to stop it and tell the user rather than nudge it again.
An owner receives an ordinary new turn when it becomes available; no model
polls or stays running to wait for another model. Ordinary user questions and
permission requests still require the human, not approval by another agent.

**Holding a project** stops new automatic deliveries and launches, not turns
already handed to a provider. There is no wake allowance: a project reports as
often as its threads settle, for as long as the work runs. DROIDEX holds it only
when deliveries run far past the pace real turns could produce — 60 within five
minutes — which reads as threads talking in circles rather than working.
A project runs as many threads as its work needs, and there is no limit on the
number of projects. What keeps one from running away is the limit of three
levels of descendants, the approval a spawn needs below High, and that hold on
threads talking in circles. A project queues at most 64 messages, counting the
ones a delivery has claimed. At most two Projects delivery turns run at once;
ordinary interactive sends keep their existing behavior.

Threads share their owner's workspace unless the spawn asks for a worktree, or
DROIDEX gives one its own because another thread is already writing in that
checkout. A thread's worktree outlives the thread: it holds that work on its own
branch, and removing it is the user's call, from the app's Worktrees settings.
Merging those branches back is still the user's call: DROIDEX opens the branch,
it does not integrate it. DROIDEX must remain running; it cannot wake a sleeping
computer.

## Not implemented

Automatic integration of thread branches and per-thread diff attribution remain
outside this draft. Review still uses the ordinary conversation/workspace facilities;
a shared checkout does not establish which agent authored each file change.

## Delivery and recovery

The project ledger is local `projects.json` under the DROIDEX user-data
directory. Writes use an atomic replacement and private file permissions.
Membership is persisted before a new session receives its first task.

The wake queue writes its claim before dispatch. **Accepted** means the
provider acknowledged the prompt, not that the model finished. The concurrency
slot stays held until that turn settles. Busy targets retain messages and
retry from lifecycle availability or runtime capacity events, not a timer.
Messages arriving during admission stay queued independently of that claim.

An unavailable or unacknowledged delivery pauses coordination with the claim
retained as uncertain. After a restart, a project whose delivery was caught
mid-flight is held the same way; the others carry on. Projects shows a held
project with a Resume control, and the Threads panel says to resume it there.
Resuming discards an uncertain claim **without resending it**; automatic replay
could duplicate work and is deliberately forbidden.

When the user stops a project's main chat, the project is held too. That
chat's own next `thread_spawn` with `reportBack` true resumes it, the way Resume in Projects does,
because the chat is working again. Only a hold the Stop alone put on is lifted
this way: a hold from a failure, from threads talking in circles or from an
uncertain delivery stays until the user resumes the project in Projects, and a
spawn that was already under way when the user pressed Stop is refused.

Malformed or incompatible experimental ledgers fail visibly and are left
untouched. This draft provides no migration from earlier prototypes. Back up
any existing experimental `projects.json` before trying a changed draft.

## Ownership in code

`ProjectService` owns the graph and bounded reports. `ProjectActivity` retains
only a bounded final reply and the last error of a managed turn, opening that
turn on the first sign of one — the streaming flag or any transcript event —
because a reply that opened no turn would be reported to its owner as silence. `ProjectWakeQueue`
owns claims, admission, cancellation and turn slots. `ProjectSessions`
correlates ordinary session creation and uses the existing scheduling receipt;
`SessionLifecycle` remains the only runtime owner. There is no second session
registry and no Projects SDK dependency.

The renderer has a feature-local snapshot, validated at the bridge boundary.
The card selector observes only displayed session fields, not token counts or
transcript arrays. The existing chat/composer is reused rather than reimplemented.
