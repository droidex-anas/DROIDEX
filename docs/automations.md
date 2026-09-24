# Automations

**Automations** in the sidebar manages both tasks that open a new chat and
one-time prompts sent to an existing conversation. Search, edit, pause, delete,
or run them now from the same list. **Scheduled prompts** filters the list to
existing-conversation deliveries.

## Send a prompt later

Open the target conversation, write a prompt or attach files, and choose
**Schedule prompt** beside Send or from the composer's context menu. Choose a
future date and time, or use **In 1 hour** or **Tomorrow, 9 AM**. The form
shows the conversation and timezone before saving.

Saved prompts appear above that conversation's composer, just like queued
messages, with the Automations clock icon and their send time. Cancel them
there, or choose Edit to open the same schedule in Automations. The strip shows
the next three prompts, with a link to the rest.

The prompt stays attached to that exact top-level conversation, even when it is
not selected or its runtime has been released. It uses the conversation's
settings, workspace, and permissions at delivery time. It does not create a new
chat or override its model. Child conversations are not scheduling targets.

Saving clears only the acknowledged, unchanged draft. A failed save preserves
it. If acknowledgement times out, check Automations before trying again: the
request may already have been saved.

At the scheduled time, a busy conversation waits in the durable queue until it
can accept a turn. This includes pending approvals, compaction, settings changes,
and ordinary queued sends. DROIDEX must be running; a missed one-time schedule
catches up after reopening or waking.

**Delivered** means the runtime acknowledged the prompt, not that the model
finished successfully. Review the conversation for its response or provider
errors. A missing target or unacknowledged delivery fails visibly. An interrupted
delivery with an unknown outcome is not automatically replayed after restart.

Use **Cancel pending delivery** while a prompt is queued or preparing to send.
This never closes or interrupts the borrowed conversation. Cancellation cannot
retract a request already handed to the runtime. Queued prompts can also be
deleted; deletion waits while delivery is starting.

Attachments are copied into private automation storage when saved, in their
original order. The source files are untouched. A schedule allows up to 16
regular files totaling 100 MiB; all saved automation attachments share a
512 MiB budget. Copies remain while referenced by a definition, proposal, run
history, or an active delivery, and are reclaimed after those references end.

## Tasks in new chats

Choose **Create automation**, then select a workspace, model, reasoning level,
autonomy, schedule, and timezone. One-time schedules require a future date;
recurring schedules support hourly, daily, weekdays, weekly, and five-field cron
expressions.

You can also ask in chat. The automation proposal card lets you review and edit
the details before confirming. Direct creation requires a High-autonomy chat;
unattended automation runs cannot create more automations.

New-chat runs execute one at a time. Existing-conversation deliveries use a
separate limit of two active scheduled turns, with one delivery per target.
Historical delivery waits for capacity rather than opening a runtime when eight
top-level runtimes are already resident or resuming. Ordinary interactive sends
are not subject to this scheduling limit.

An automation cannot stack another open run. Three consecutive failed runs
pause its schedule; inspect the error, fix the cause, and turn it back on.

Local execution uses the selected folder. Worktree execution creates an isolated
Git worktree. Completed runs retain their chat and worktree for review; closing
the review chat triggers cleanup. Inspect cleanup errors before removing files.

## Implementation

The sidecar automation manager serializes persistence. The catalog owns task
definitions and the existing scheduler owns wake timing for both target kinds.
The run queue owns new-chat sessions and worktrees; the delivery coordinator
borrows existing sessions by stable `appSessionId` without adding ownership or
cleanup hooks to them.

Delivery persists its starting state before dispatch, validates the captured
runtime after asynchronous setup, and waits for runtime acknowledgement.
Availability callbacks rearm busy targets without a renderer polling loop.
The renderer consumes validated snapshots, virtualizes the management list,
and sends acknowledged commands. Mutations fail while disconnected rather than
being replayed from an offline queue.

Proposal results use JSON from the automation tools, either directly or inside
MCP text content. The renderer does not recover proposal IDs from malformed JSON,
Markdown fences, or unrelated nested fields. Tool errors appear on the card.
