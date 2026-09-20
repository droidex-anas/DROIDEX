# Local Projects

A project is one conversation that can run others. Its main conversation and
the threads it spawns are normal top-level sessions, not harness subagents:
each keeps its own history, settings, transcript and runtime identity, and each
can be opened, steered and reviewed like any other chat.

## Starting threads

Any chat can start a thread, because DROIDEX gives every interactive chat the
`droidex-threads` MCP tools: `thread_spawn`, `thread_send`, `thread_stop` and
`plan_set`. Asking a chat to run work in parallel is
enough — it spawns the threads itself, and the chat becomes that project's main
conversation on the first spawn. `thread_spawn` follows the chat's own
autonomy: it is auto-approved at High and asks the user otherwise; the other
four tools only move text between conversations DROIDEX already owns.

A thread inherits the workspace, harness, model, reasoning level and autonomy
of the chat that spawned it unless the call names different ones, and it can
never exceed its owner's autonomy. DROIDEX isolates a thread on its own: a checkout that already has a thread
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
which reaches the waiting call directly instead of queueing behind the question
that is blocking the thread. The human can still answer it inside the thread;
whoever answers first wins and the other side stops asking. A paused project
routes nothing: its threads wait for the user.

Permission requests are never routed. They stay with the person, whatever the
project is doing.

## The plan

The lead keeps a plan with `plan_set`: the steps it means to take, optionally
grouped under milestones, each one able to name the thread carrying it.
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
a quiet notice rather than a message wearing the user's bubble.

Opening or selecting a thread does not stop its siblings. **Stop** interrupts
that thread and cancels its queued work.

A settled managed turn reports only a bounded excerpt of its final primary
reply to its direct owner. Tool output and thinking never enter that report.
An owner receives an ordinary new turn when it becomes available; no model
polls or stays running to wait for another model. Ordinary user questions and
permission requests still require the human, not approval by another agent.

**Holding a project** stops new automatic deliveries and launches, not turns
already handed to a provider. There is no wake allowance: a project reports as
often as its threads settle, for as long as the work runs. DROIDEX holds it only
when deliveries run far past the pace real turns could produce — 60 within five
minutes — which reads as threads talking in circles rather than working.
Projects allows up to eight threads per project, three levels of descendants,
32 projects and 64 queued/claimed messages per project. At most two Projects delivery turns run
at once; ordinary interactive sends keep their existing behavior.

Threads share their owner's workspace unless the spawn asks for a worktree.
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
retained as uncertain. After restart, projects are paused, and the Threads
panel says so with a Resume control. Starting a thread from a live conversation
resumes coordination the same way that control does, and refuses for the same
reason: an uncertain delivery must be reviewed first. Resuming discards that
claim **without resending it**; automatic replay could duplicate work and is
deliberately forbidden.

Malformed or incompatible experimental ledgers fail visibly and are left
untouched. This draft provides no migration from earlier prototypes. Back up
any existing experimental `projects.json` before trying a changed draft.

## Ownership in code

`ProjectService` owns the graph and bounded reports. `ProjectActivity` retains
only a bounded final reply during an active managed turn. `ProjectWakeQueue`
owns claims, admission, cancellation and turn slots. `ProjectSessions`
correlates ordinary session creation and uses the existing scheduling receipt;
`SessionLifecycle` remains the only runtime owner. There is no second session
registry and no Projects SDK dependency.

The renderer has a feature-local snapshot, validated at the bridge boundary.
The card selector observes only displayed session fields, not token counts or
transcript arrays. The existing chat/composer is reused rather than reimplemented.
