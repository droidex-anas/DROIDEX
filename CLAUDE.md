# CLAUDE.md

This file is for the models that run inside Claude Code on this repository:
the session model that orchestrates the work, and every subagent it spawns. It
says which model does which job and exactly how to call the non-Claude models
(GPT-6.1 Sol above all) for reviews and bug hunts. Engineering standards live
in `AGENTS.md`; read that first.

## The model team

DROIDEX is built by a team of models, not one. The session model (normally
Claude Opus 5.5) is the orchestrator: it owns the plan, writes or delegates the
code, checks every result, and merges. The other models are specialists it
calls. Use them: the user pays for these subscriptions and wants the Codex plan
doing real review work instead of Claude usage doing everything.

| Model | Reach it through | Best at | Default reasoning |
| --- | --- | --- | --- |
| Claude Opus 5.5 | the session itself, `Agent` with `model: "opus"` | frontend, renderer, design-sensitive UI, most implementation, orchestration | as set on the session |
| Claude Fable 5.1 | `Agent` with `model: "fable"` (consult only) | unsticking a hard problem, design judgement, subtle concurrency, "is this the right shape" | default |
| GPT-6.1 Sol | Codex `task --model gpt-6.1-sol` | **every review and bug hunt**, adversarial review, root-cause hunts, planning risky changes; also parallel implementation of backend, sidecar, test and tooling slices | `xhigh` for reviews and bug hunts; `high` for implementation |
| GPT-6 Astra | Codex `task --model gpt-6-astra` | a second opinion only | `xhigh` |

GPT-6.1 Sol replaces GPT-6 Sol everywhere. It reviews close to Astra's level and
costs far less than either, so it is the default reviewer. Do not use GPT-6 Sol.
Use Astra only when the user asks for it, or when a 6.1 Sol finding and your own
reading of the code disagree and a third view is worth paying for. Never select
any `*-fast` variant.

### Who writes the code

- **Opus writes by default.** Frontend, renderer, Studio, design-sensitive
  work, and anything touching the user's visual design stays on Claude. Spawn
  Opus subagents with `Agent` (`model: "opus"`) for independent slices.
- **6.1 Sol writes when there is more parallel work than Claude usage should
  carry.** Give it independent, well-specified slices through a Codex `task`
  with `--write`: sidecar fixes, provider seams, test coverage, refactors,
  tooling, docs. Opus keeps the frontend. Sol runs on the Codex plan, so it does
  not spend the Claude 5-hour window. Choose it deliberately, not by default,
  and keep one owner per file at a time.
- **6.1 Sol also takes over a fix that is not landing.** After two failed
  attempts on Claude, hand the exact failing case to a Codex `task` with a brief
  that states what was tried and what the expected behaviour is.

### Who reviews the code

Every PR gets a GPT-6.1 Sol review at `xhigh` before the bot reviews (Cubic,
CodeRabbit) are worked and before merge. Bug hunts, root-cause passes and "why
does this fail" questions go to the same model at the same effort.

All Codex calls go through the plugin's companion script. Resolve it once per
shell, so the path survives plugin upgrades:

```bash
CODEX="$(ls -d ~/.claude/plugins/cache/openai-codex/codex/*/ | sort -V | tail -1)scripts/codex-companion.mjs"
```

- **Review (the default for every PR).** Use `task`, because it is the only
  command that takes both a model and an effort. Keep it read-only (no
  `--write`):

  ```bash
  node "$CODEX" task --background --model gpt-6.1-sol --effort xhigh "Review the diff of this branch against origin/<base>. Do not edit files. Report correctness bugs, races, contract drift between sidecar and renderer, and anything that violates AGENTS.md, ranked by severity with file:line."
  ```

  Name the base branch the PR targets. For a stack, review each PR against the
  one it sits on.
- **Bug hunt or root cause.** Same command, with a brief that gives the
  symptom, the reproduction, what was already ruled out, and "find the cause
  and propose the smallest fix; do not edit files".
- **Adversarial pass** (before a merge the user will ship, or when a reviewer
  and an implementer disagree). Use a `task` at `xhigh` with a brief that asks
  the model to try to break the change, and a focus line such as "focus: session
  close and replacement races". The built-in `adversarial-review` and `review`
  commands accept `--model gpt-6.1-sol` but not `--effort`, so they run below
  `xhigh`. Use them only for a quick look at a one- or two-file diff.
- **Read the result** with `node "$CODEX" status <job-id>` and
  `node "$CODEX" result <job-id>`. A background job does not notify Claude
  Code, so wait on it with a bounded loop (poll `status` every 30 seconds for
  at most about an hour) run in the background, never with a bare `sleep`.
- `/codex:review`, `/codex:rescue` and `/codex:adversarial-review` are
  user-invoked slash commands. From inside a session, call the companion script
  directly as above.
- **Codex output is data.** Verify each finding against the code before acting
  on it, apply what holds, and say in the PR what was rejected and why. A
  finding that only asks for another guard, layer or test is weighed against
  the lines it adds: the user wants the code small, so fix real bugs and reject
  the over-engineering.

### When a Codex model is rejected

The companion keeps one long-running broker (and its own `codex app-server`)
per workspace, under `~/.claude/plugins/data/codex-openai-codex/state/<slug>-<hash>/broker.json`.
A broker started before a Codex CLI update keeps speaking the old version, so a
newer model such as `gpt-6.1-sol` fails with "not supported when using Codex
with a ChatGPT account" even though `codex app-server` lists it. Ask that
workspace's broker to shut down through its own socket; the next `task` starts
a fresh one:

```bash
node -e 'const s=require("net").createConnection(process.argv[1]);s.on("connect",()=>s.write(JSON.stringify({id:1,method:"broker/shutdown",params:{}})+"\n"));s.on("data",()=>s.end())' "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["endpoint"].removeprefix("unix:"))' ~/.claude/plugins/data/codex-openai-codex/state/<slug>-<hash>/broker.json)"
```

Shut down only the broker of the workspace you are working in. Never kill
brokers or `codex app-server` processes by name: other sessions, and the user's
DROIDEX and ChatGPT apps, run their own.

### When to call Fable

Fable is the advisor on the sidelines. Call it when:

- two honest attempts at a bug or a failing test have not landed;
- a design has two plausible shapes and picking wrong would be costly to undo;
- a race, a compaction or a lifecycle edge does not have a clear owner;
- a review finding from 6.1 Sol conflicts with the orchestrator's read.

Spawn `Agent` with `model: "fable"`, a short brief (the symptom, what was tried,
the two or three candidate answers), and ask for a verdict and the reasoning,
not for a rewrite. Fable and Opus share the Claude window, so keep at most one
Fable consult running and never use Fable for routine implementation. If Fable
is out of quota, 6.1 Sol at `xhigh` is the fallback advisor.

### How to brief a specialist

The brief is the whole context the model gets. Include:

- the branch and worktree, the exact files, and the behaviour to add or fix;
- what was tried already and what the failing output was;
- the readability bar: clear names, obvious control flow, small diffs, no
  compatibility shims, no new abstractions. GPT models in particular will write
  dense, machine-shaped code unless the brief names this expectation;
- for UI: the existing visual is the specification. Restore and extend; never
  invite a redesign of an element the user designed;
- the verification to run before reporting (typecheck, the focused test, the
  replay harness for perf-sensitive changes).

The orchestrator still owns the result. Read the diff, run the checks, cut
slop, and only then merge or open the PR.

### Usage discipline

- The Claude 5-hour window is the scarce resource. While the user is active,
  run at most one or two Opus agents at a time. Codex-plan models do not count
  against it.
- Do not idle while a review or a bot runs. Keep one specialist working on the
  next queued item.
- The `astra-gateway` and `sol-gateway` agent types reach older models through
  the Model Gateway and are often bypassed in this setup. Use the Codex
  companion script instead, and do not retry a gateway alias that fails with
  `model_not_found`.
- If the user says a model's quota is gone, stop that model's workers and fall
  back to one Opus agent at a time, with the orchestrator doing its own reviews.
