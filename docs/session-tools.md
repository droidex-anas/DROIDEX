# Session tools

A chat on Droid or Claude Code is given DROIDEX's in-app MCP server,
`droidex-sessions`. It carries the thread tools described in
[Projects](projects.md) and five tools for the other chats in the user's
sidebar:

- `session_list` lists the chats the sidebar shows, most urgent first, each
  with the status the sidebar gives it. It can be narrowed to the chats that
  need the user or the ones working.
- `session_read` reads one of them: its status, the approval or question it
  waits on word for word, its harness, folder and settings, and the last 4,000
  characters of its latest final reply.
- `session_send` sends one of them a message, or the answers to the question it
  waits on.
- `session_stop` stops the turn one of them is running and drops its queued
  messages.
- `session_mark` settles, reopens or archives up to 20 of them.

A chat can also start an ordinary sidebar chat with `thread_spawn` and
`reportBack` false, and then follow it with `session_read`.

## Who can use them

Only ordinary chats, whether or not they lead a project. A project thread is
refused, because the chat that started it manages the rest; so are mission and
design sessions. Unattended automation runs are never given the server, and the
Codex runtime has no MCP path, so a Codex chat has none of these tools. Codex
chats are still listed, read, messaged, stopped and marked like any other.

## Approval

| Tool | Below High | High |
| --- | --- | --- |
| `session_list`, `session_read` | runs | runs |
| `session_send`, `session_stop`, `session_mark` | asks | runs |

An "Always allow" for `session_send` or `session_stop` covers only the chat it
was given for, and one for `session_mark` covers only that mark on exactly
those chats. Claude Code at High runs with its permissions bypassed, so every
refusal below is enforced by the tool itself, whatever the approval.

## What they read

The window owns the sidebar: which chats it shows, what it calls them, their
status, unread, pins, settle markers and the approvals and questions it holds.
Each call sends the window a `sidebar.request` and waits up to three seconds for
its `sidebar.result`. The window answers from one read of its store with the
same status function the sidebar draws with, so the two cannot disagree, and
nothing runs in the window between calls. Archived and deleted chats and project
threads are never in the answer, and the calling chat is left out of it. When
the window does not answer, during a reload say, the tool fails rather than
guess. The window neither answers nor acts in the last second before the
sidecar stops waiting, so it never applies a change the tool already reported
as failed.

The sidecar adds what it owns: each chat's harness, folder, settings and
queued messages; for a project's main chat, the project, whether it is held and
how many of its threads wait on the user; and for `session_read`, the end of the
latest reply, read from the newest 200 events of the stored transcript with the
rule thread reports use.

The sidebar's Activity view works out Awaiting your reply and Uncommitted
changes only while it is on screen, so these tools report such a chat as
Recent and say so.

## What they refuse

`session_send` is refused to a chat waiting on an approval or a plan, to a chat
waiting on its own question unless it carries one answer per question, to a
chat that runs at a higher autonomy than the caller, and to an automation run.
After ten messages to one chat in five minutes, from any chats, it is refused
until that settles, because chats messaging each other in a loop would keep it
busy forever. That count is kept in memory and resets when DROIDEX restarts.

`session_stop` is refused to a chat waiting on the user, because an interrupt
would throw away the decision the user owes, and to a chat with no turn
running. It is not the user's Stop, so it never holds a project.

`session_mark` applies the sidebar's own gestures, checked by the window as the
change lands: a working chat or one waiting on the user cannot be settled or
archived, a chat with activity newer than the caller saw cannot be settled, a
chat whose pull requests are all closed stays settled, and the chat on screen
cannot be archived. A project's main chat cannot be archived either; it is
managed in Projects.

No tool approves a permission request, marks a chat read, deletes or restores a
chat, closes a runtime, or changes another chat's model, autonomy or mode.

## Delivery

A message to a chat running a turn joins that chat's own queue, as a prompt
typed during a turn does. Otherwise it starts a turn at once, opening a
released chat when fewer than eight are open. The tool waits only for the
runtime to take the prompt, never for the turn. The chat reads the message as
coming from DROIDEX on behalf of another chat, never from the user, and the
window shows it as a notice led by "Message from" and that chat's name.

Answers go straight to the call waiting on the question, the way a lead
answers its threads. The chat's transcript gets a status line naming the chat
that answered, and the window stops showing the question.
