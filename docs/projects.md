# Local Projects

A project is one conversation that can run others. Its main chat and the threads
it starts are normal top-level sessions, not harness subagents: each keeps its
own history, settings, transcript and runtime identity, and each can be opened,
steered and reviewed like any other chat.

## How a project runs

**What is kept.** `projects.json` is the project's memory: who started whom,
each thread's latest reply, messages waiting to be delivered, threads waiting
to start, the plan, the lead's to-dos, holds and unread flags. A thread's reply
is saved before its report is sent, so a report can be missed but never lost.
Every conversation also keeps its own full transcript.

**Who is in charge.** The lead owns the goal and the plan and is the one chat
that talks to the user. Every thread belongs to the chat that started it;
threads can start their own, up to three levels below the lead. The lead
controls every thread in the project; any other thread controls only its own.
Threads inherit their owner's autonomy and can never exceed it. Messages from
the lead or direct owner are instructions within that ceiling; reports remain
data. Permission prompts wake the lead and show an approval state. The lead can
use `thread_approve` only for an action its own autonomy permits without asking.
Requests beyond that authority require one question to the user; no approval
changes a sandbox or raises autonomy.

**How a report reaches the lead.** When a thread finishes, its report goes to
its owner. If the owner is in a turn, the report is steered into that turn; if
it is idle, the report starts a new turn. A steered report settles when handed
to the provider. A definitive refusal returns it to the inbox for another try,
including when the user stopped the lead meanwhile; it waits until the user
continues the lead. An unconfirmed outcome stays settled and is never replayed.

**Unread is the safety net.** A new reply marks its thread unread until the
lead reads it (`thread_read`), a turn starts with that reply's report, or the
provider confirms consumption of that reply's steer. An uncertain withdrawal
or an older report's acknowledgement never clears a newer reply. If a report
is handed over just as the lead's turn is stopped, the thread stays unread.
After a restart or compaction, the lead calls `project_read` first and reads
the unread threads. After a stop it can also use `thread_list`; every wake lists
unread threads apart from the reports themselves. Being unread does not wake
anyone by itself. Resume lifts the hold before queuing an unread reminder
when no message is already waiting for the lead and the inbox has room. With
no unread replies, an idle lead gets a coordination wake instead. A full inbox
can skip the unread reminder and never blocks Resume. Wakes list at most 20
unread thread titles and count the rest; every unread thread remains discoverable
through `thread_list`.

**What wakes the lead.** A report, a thread's question or approval request, a
thread's failure or rate limit, a due to-do, the last working thread going idle
(with how it ended), a message from the user, and Resume. Nothing else: reading,
listing, planning and waiting never start a turn. A held project delivers nothing
until it resumes. Nested failures also notify the project lead. Rate-limited
threads show the provider's reset time when known and need `thread_send` after
that time. An idle team with unfinished plan work gets a durable wake after a restart.

**Runtime slots.** Starting and restoring threads automatically shares
**20 runtimes**, counting ones still starting. Threads waiting to resume go
before newly queued threads, and queued threads start in the order they were
queued. Delivery admission rotates fairly between projects of the same priority.
At most two worker deliveries start turns at once; sleeping leads have
a separate lane and wake before new worker starts. Steering into a running turn
needs no slot. A runtime idle for 30 minutes is released to save memory (only
the three most recent idle ones may stay that long). A message to its thread
brings it back with its conversation intact. Chats the user starts are never
capped.
Lead wakes may exceed the automatic limit so workers waiting for answers cannot
deadlock the project. Worker resumes and queued spawns still honor the limit.

**Stop and Pause.** Stop on the lead stops only the lead; workers continue and
their reports wait until the user sends the lead a message or explicitly
resumes. Starting another thread never releases that Stop. Hold project (or
`project_pause`) interrupts active work and records which turns it interrupted.
`project_resume` continues those turns and drains retained reports; previously
stopped threads stay stopped. A delivery loop above `max(60, 3 × threads)` in
five minutes holds the project with a message naming the cause.
A late Stop receipt does not mark a thread stopped if a newer turn has opened.

**After a restart.** DROIDEX loads the transcripts first. Waiting messages and
queued threads are kept. A queued thread keeps its initial task until its first
turn starts. A thread cut off mid-turn gets one "continue" from DROIDEX unless
it was explicitly stopped or a message for it is already waiting. Finished
threads whose runtimes were idle receive no continuation, and finished projects
stay done. Interrupted work is recorded even when startup finds the project
held, and continues only after Resume. An explicit thread Stop remains durable
across restarts until another turn starts.
An in-flight delivery that held only reports leaves identified, durable replies
unread. Reports without a reply identity or retained reply text return to the
pending queue, including failed, stopped and empty turns. Any other in-flight
delivery holds the project for review, and Resume discards it.
A ledger that cannot be read is reported and left untouched.

| Tool | Changes now | Later effect |
| --- | --- | --- |
| `thread_spawn` | Records task, thread and checkout; starts when admitted | Queues for capacity; below High needs approval |
| `thread_send` | Sends instructions with `steer`, `interrupt` or `queue` | Returns the outcome and state after: steered, started, resumed, queued with position, held or interrupt |
| `thread_answer` | Answers the current `questionId`, one answer per question | Refuses stale questions; never reopens completion |
| `thread_approve` | Allows once or denies a controlled pending request within the caller’s autonomy | Returns state after; optional note queues instructions; held projects must resume first |
| `project_pause` | Lead only: holds new work and interrupts active threads, leaving the caller running | Returns interrupted ids; records their work for Resume |
| `project_resume` | Lead only: resumes the project and drains retained reports | Returns ids queued to continue work interrupted by Pause; uncertain deliveries need user review in Projects |
| `project_guide` | Returns the full lead playbook | Read at the start and after compaction |
| `project_read` | Recovers brief, milestone, plan, decisions, to-dos and unread/relevant threads | First call after restart or compaction; starts no work; clears no unread reports |
| `thread_list` | Reads threads, unread, runtime load and to-dos | Starts no work |
| `thread_read` | Reads replies and durably clears unread; `full: true` reads the latest settled final reply from its transcript | Starts no work; ordinary reads keep bounded ledger previews |
| `thread_configure` | Sets autonomy or queued launch settings | Running model/effort changes wait for settlement |
| `thread_stop` | Interrupts and drops queued messages; cancels queued starts | A late refusal cannot restore messages withdrawn by this Stop |
| `plan_set` | Saves plan, optional title and agreed `brief` (≤2,000 characters) | Lead owns planned/doing/review/done/blocked; ids survive reordering and explicit ids survive renaming |
| `project_done` | Records outcome after work is handled | Refuses with unread reports, open to-dos, failed/approval-waiting threads, pending messages and active work; new work reopens it |
| `todo_add` | Saves a follow-up: `after`, `inMinutes` or absolute ISO `at` | Due after the next report, including failure/interruption, or the reminder time; first trigger wins |
| `todo_done` | Removes follow-up and pending reminder | A handed-off reminder may still arrive |

Projects ships in beta. The Projects view says so under its title, with links to
the app's own feedback and bug report (the dialog `/feedback` and `/bug` open)
and to the maker's account on X. A one-time spotlight beside the sidebar's
Projects entry introduces the feature once the first-run welcome card is gone;
it is one of the sidebar's announcements (`src/lib/sidebarCards.ts`, id
`projects-beta`).

## Starting threads

A chat on Droid, Claude Code or Codex is given DROIDEX's in-app session tools.
Droid and Claude Code receive the `droidex-sessions` MCP server; Codex receives
the same tools as deferred dynamic tools in `droidex_sessions`. Sixteen run a
project: `thread_spawn`, `thread_send`, `thread_list`, `thread_read`,
`thread_configure`, `thread_stop`, `thread_answer`, `thread_approve`,
`project_guide`, `project_read`, `project_pause`, `project_resume`, `plan_set`,
`project_done`, `todo_add` and `todo_done`.
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

Session-tool approval cards show a human action title and a short detail; a
spawn names the thread and the first line of its task, rather than its full brief.
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

## A thread's questions reach the chat that started it

When a thread asks its harness's own question, the one a person clicks an answer
to, DROIDEX routes it to the chat that started the thread, options intact, and
wakes that chat. That chat answers with `thread_answer`'s `answers`, one per
question, which reach the waiting call at once instead of queueing behind the
question; instruction sends are refused while the thread waits. The answers
name the question by the `questionId` its wake and `thread_read` give, and are
refused when the thread now waits on another question. The user can still
answer inside the thread, and whichever answer comes first wins. A held project
retains questions until it resumes.

Permission requests remain visible in the thread and wake the project lead.
An `approval` state carries the pending request id and summary in `thread_list`,
`thread_read` and `project_read`. The lead or direct owner can allow once or deny
with `thread_approve` only within its own autonomy, after any project hold is
resumed. The result names the state after; an optional note queues instructions.
When the action needs more authority, the lead asks the user one question so the
user can decide the request in the thread.

## Steering a thread

`thread_send` reaches a working thread the way the user's Steer does: the
harness takes the message at its next step inside the running turn, with its
own steer on Droid, Claude Code and Codex alike, or right after that turn when
it cannot take it sooner. `delivery: 'interrupt'` is Send now: DROIDEX
stops the running turn and the message runs next. `delivery: 'queue'` waits for
the turn to end. A stopped or idle thread queues the message through the
project's queue and waits for a runtime slot when capacity is full. When a
working thread's turn ends or is
stopped while the message is on its way, the send is refused rather than
starting a new turn a Stop meant to end, and the chat reads the thread and
sends again. The tool says whether the message was steered, started, resumed,
queued, held or interrupted,
with its queue position and wait reason when queued. A queued result means it has not
started yet. Continue a stopped or queued thread with `thread_send` instead of
spawning another. A spawn still creates a thread when its title matches a
stopped, idle or queued one, but names that existing thread and suggests
continuing it; title matching ignores case and a trailing number or `(retry)`.

## Recovering the project and keeping follow-ups

After the first `project_read` on compaction or restart, `thread_list` returns
controlled threads that are working, queued, waiting, failed, unread or still
owe a report. The remaining
threads are counted in one line; pass `all: true` to list them too. Each row
includes its full id, title, owner id, state, wait reason, a one-line preview of
up to 120 characters of its latest reply and its queued message count. It also
returns runtime load (`live`: in use, running or starting, including reserved
opens and resumes; `limit`: automatic runtime limit) and the lead's open to-dos. A main chat
reaches all other threads in its project; a thread lists only its direct children.
`thread_read` returns the same wait reason and runtime load with the full reply
readout and clears unread only after saving succeeds. A failed save returns an
error and keeps the thread unread. Neither tool starts or resumes a runtime,
even when capacity is full, a thread is stopped or the project is held.

Every thread-id argument accepts the full id or a unique prefix of at least
eight characters within that scope, including `workspaceOf`, plan links and
`todo_add.after`. An ambiguous prefix fails with the matching titles and full
ids. Runtime calls and returned ids use the canonical `appSessionId`.

The lead records follow-ups with `todo_add({ text, after?, inMinutes?, at? })`, then
removes a handled follow-up with `todo_done({ id })`. A project holds at most 40
open to-dos; text is 1–400 characters. `after` marks it due when that thread
next reports, including failure or interruption. `inMinutes` is an integer from
1 to 1440; `at` accepts a future ISO timestamp with timezone for reminders days
away. Choose one time field. Both persist an absolute due time, so DROIDEX rearms
the reminder after a restart once session history is ready. If `after` and a
time are present, the first trigger makes it due. With neither, it stays in the
open list until handled.

Every wake lists the open to-dos in its own section before the thread reports,
due ones first and marked `[DUE]`. A timed reminder uses the same delivery path
as a report: a busy lead receives it when that path can deliver, a held project
waits for Resume, and a full inbox retains
the due reminder until room opens. Each reminder queues once; it remains due
until `todo_done` removes it. Removing a to-do also drops its pending reminder;
a reminder already handed over may still arrive. Use these follow-ups instead
of polling `thread_read` in a loop. Reports may arrive during the lead's turn.

The project snapshot exposes open to-dos, runtime load, thread state (including
`queued`) and wait reasons for the Threads panel. Queued starts show their
position (for example, **Queued · 2nd**); runtime-slot waits show **Waiting for a
slot · 1st**. Cancelling a queued spawn removes its thread and releases its
reserved checkout. `thread_configure` updates its settings while queued. During opening it refuses
changes with a retry message; configure it again once it has started.

## The plan

The main chat keeps a plan with `plan_set`: the steps it means to take,
optionally grouped under milestones, each one able to name the thread carrying
it. A chat that is not a project yet becomes one with its first plan, so it can
plan first and then start a thread for each step. `thread_spawn` takes the step
it carries, so starting the work links the step to its conversation. The lead
owns every step’s state: `planned`, `doing`, `review`, `done` or `blocked`,
independently of whether its linked thread is running. Step ids stay stable
when steps move; pass the existing `id` when renaming a step. A new explicit
`id` creates a step, including in the first plan; omitted ids are generated.
The plan holds at most 60 steps, is stored in the project ledger, and appears
above the threads wherever the project is read.

`plan_set` also takes an optional `brief` (at most 2,000 characters): the
agreed goal, scope, out of scope, done criteria and authority. `project_read`
returns it with the current milestone, plan, step notes as decisions, open
to-dos, unread reports and relevant threads without changing anything. The lead
calls it first after restart or compaction, and reads `project_guide` at the
start and after compaction.

`plan_set` also takes a `title`: a few words for the goal, which name the
project and its main chat in place of the opening prompt. Once the goal is
achieved, the main chat calls `project_done` with what the project achieved.
It refuses with every outstanding item: unread reports, open to-dos, failed or
approval-waiting threads, pending messages and active work. Projects then shows
it as done, with that outcome and how long the project took. Any work after that
reopens it: a new thread (including a queued one), a message to a thread, a thread
starting a turn, or a plan with any step that is not done. Answering a historical question does not
reopen it. A project records when it started; one from before that shows its
main chat's start.

## The Threads panel

The chat's utility panel has a **Threads** tab. It opens with a short greeting
that changes through the day, the project's name, and how long it has been
running or how long it took, with the outcome once it is done. A paused project
says that work and messages are kept and offers Resume; a stopped lead says that
the team keeps working while its reports wait. Below them come the plan, headed by how
many of its steps are done, and the threads, grouped the way the sidebar's
Activity view groups chats, with **Waiting** and **Queued** for project admission.
**Needs you** previews the approval or question in one line. Each
heading carries its count and folds its section. Each row
carries the thread's own last step and how long ago it moved. The states come
from the signals the sidebar reads, a pending approval or question, the session
phase and the chat's activity digest, so the panel never claims something the
app cannot back up.

Opening a row shows that thread's transcript read-only, loading its history
first if this window has not. Pending questions, approvals and plans can be
answered there through the same inline cards the chat uses. **Open** brings it into the main pane,
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

Thread reports lead with the conclusion and what was or was not changed, then
the few findings that matter with numbers, a link to the full write-up and
honest caveats. Implementers also name branch, commits and checks. If a task
produces a long write-up, it lives in `reports/<step>/` in the thread’s worktree,
never `/tmp`. Short or workspace-free tasks need only the final report.

A settled turn of a thread reports to the chat that started it however it ended:
an excerpt of its final primary reply, the error that failed it, that it was
stopped, or that it ended without a reply. A reply longer than 1,200 characters
keeps its beginning, marks truncation and points to `thread_read({ full: true })`.
Thinking and tool output never enter a report. `thread_read` gives that chat the
rest: the thread's latest replies, up to their first 8,192 characters each, the
question it is waiting on and what it is running as, so the chat can look again
after a compaction or before deciding a step is done. It returns the latest
reply alone unless asked for more. `full: true` reads the latest settled final
reply from the transcript without truncation. DROIDEX keeps up to ten replies
for each of the eight settled threads
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
pulling one costs a whole extra turn. The lead reads the full settled reply before accepting work and reports
only what matters to the user.

Reports use the project delivery path and may reach a lead mid-turn. No model
polls or stays running to wait for another model. The lead may approve only
within its own authority; anything beyond that needs the user. A question can be
answered by another chat: a thread's by the chat that started it, and any sidebar
chat's by a chat that sends it answers with `session_send`.

## Holds and limits

**Holding a project** stops new automatic deliveries and launches. An explicit
Pause also interrupts active work, records what it interrupted and leaves a
tool caller's own turn running. Stop or failure of the lead leaves workers
running; reports wait until the user continues the lead or resumes the project.
Closing the lead also stops coordination while workers continue. Delivery failures, uncertain claims, a
question at a full inbox and persistence failures also hold it. A delivery loop
above `max(60, 3 × threads)` in five minutes holds the project with an actionable
message. Otherwise, threads can report as often as they settle.

A thread's report that finds the inbox full does not hold the project. It waits
on the thread and queues as soon as a delivery makes room; a newer report from
the same thread replaces it.

A project runs as many threads as its work needs, and there is no limit on the
number of projects. What keeps one from running away is the limit of three
levels of threads below the main chat, the approval a spawn needs below High,
and that hold on threads talking in circles. A project queues at most 64
messages, counting the ones a delivery has claimed. At most two worker delivery turns run at once across all projects; sleeping
leads have a separate lane and wake before new worker starts. Ordinary
interactive sends keep their existing behaviour. A delivered turn stopped on a question for its owner,
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
its final reply this way says so and points to `full: true` to read the latest
settled reply from its transcript. A ledger that still passed 8 MiB would be
refused, and every project held. Membership is persisted before a new session
receives its first task.

The wake queue writes its claim before dispatch. A steered update settles when
`session.steer(text)` is called. A definitive `false` restores the batch under
the same project's ownership, even after lead Stop or project Pause. Only an
explicit `thread_stop` withdrawal cancels recovery for that target, including
if it has since continued. Restored updates wait for recipient availability;
updates to a stopped lead wait for the user to continue it. An `unconfirmed`
outcome stays settled and is never replayed.
Restoration preserves the inbox limit. A refused report that finds it full waits
as its thread's `owedReport`; a question stays on its waiting ask, and an approval
stays on its pending permission request. Refill queues these updates once room
opens. Due reminders likewise retain their to-do until it can queue again.
Confirmed consumption clears unread only for the reply that report carries;
an uncertain or missing acknowledgement leaves it unread.
An idle owner's scheduled turn keeps its existing receipt:
**Accepted** means the provider acknowledged its prompt. Its concurrency slot stays
held until that turn settles, except while the turn waits on a question routed
to the chat that started it, or on the user's permission: it runs nothing then,
and holding the slot could keep that chat from ever being woken to answer, or
stop every other project's reports until the user comes back. Busy targets retain messages and
retry from lifecycle availability or runtime capacity events, not a timer.
Messages arriving during admission stay queued independently of that claim.

Automatic worker opens and resumes share a limit of 20, including opens still
in flight; lead wakes may exceed it to keep coordination moving.
Queued spawns keep their original task, checkout reservation and
position in the ledger; checkout instructions are added only when launching.
Workspace-free launches omit `cwd`; launch persistence failures hold only the
affected project.
They start when capacity opens, after resumes that can be admitted. A resume
blocked by its own project's delivery does not hold up other projects' spawns.
That project's spawns wait until its delivery claim clears and its pending
resumes go first, including resumes parked on busy or capacity markers.
Projects take turns admitting deliveries, so one project's backlog cannot
starve another project. Reports and due reminders can steer into a busy owner's
turn without starting a competing turn. Stop waits for admissions; steered
handoffs settle without waiting for provider acknowledgement. An unread reply
remains discoverable through `thread_list` and the next wake when consumption
is unconfirmed. Definitive refusals retain delivery independently of unread.
Interrupted threads receive one restart continuation only when they
have no instruction already queued, including when the inbox is full.

A report refused before handoff or definitively refused by the provider returns
to pending or its thread's owed report. A scheduled turn whose outcome is unknown
holds the project for review. A withdrawal before dispatch, by Stop, a hold or a question its thread stopped
asking, returns messages to the queue, less the withdrawn question. After a
restart, reports in a sending claim with an identified, durable reply are
dropped: their replies remain unread. Reports without a reply identity or
retained reply text return to pending and remain in compact `thread_list` until
delivered. Other claims caught mid-flight hold the project; the others carry
on, delivering what the restart left queued once session
history has loaded. No delivery goes out before that, because until
then a thread reads as an unknown session. Projects shows a held project with a
Resume control, also available in the Threads panel. Resuming discards
an uncertain claim **without resending it**; automatic replay could duplicate
work and is deliberately forbidden.

Stop on the lead leaves workers running and retains reports until the user
continues the lead or resumes the project. A new spawn never clears that Stop.
Closing the lead also stops coordination while workers continue. Project Pause interrupts active work and
retains its ids; Resume continues only that work and drains reports. A hold
from an uncertain delivery needs explicit review in Projects before Resume
discards the claim without replay. Spawns already underway when the user
presses Stop are canceled, including the first spawn of an ordinary chat.

Malformed ledgers fail visibly and are left untouched. String `owedReport`
values load as `{ text }`; saves use that object shape, optionally with a reply
identity. A ledger without `todos` loads with an empty list; a thread without
`queuedSpawn` has no queued launch.
If a to-do's `after` thread has left the project, only that link is removed; the
note and any time trigger remain.

## Ownership in code

`ProjectService` owns project membership, plans, holds and tool authority.
`ProjectInbox` owns refusal recovery, retained reports and questions, restart
continuations, approval notices and idle wakes; interruption identities
discovered while held live in the ledger.
`ThreadLaunches` owns queued launch order and binding and reuses a bound provider
for the original task after restart. `ProjectReads` owns snapshots, transcript
reads and reply-specific unread acknowledgement. Stored steer message ids keep
mid-turn instructions inside their turn when a transcript is replayed.
`ProjectTodos` owns durable
follow-ups and their next-due timer; `ProjectHolds` owns hold generations and the
pause/resume interruption race. `ProjectTurns` reads each settled turn of a project
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
