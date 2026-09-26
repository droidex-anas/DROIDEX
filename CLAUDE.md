# CLAUDE.md

Engineering standards live in `AGENTS.md`. Read it first; everything below is
about how the model team is run on top of those standards.

## The model team

DROIDEX is built by a team of models, not one. The session model (normally
Claude Opus 5.5) is the orchestrator: it owns the plan, writes or delegates the
code, checks every result, and merges. The other models are specialists it can
call. Use them; the user pays for all of these subscriptions and wants the idle
ones (Codex Pro) doing real work instead of Claude usage doing everything.

| Model | Reach it through | Best at | Default reasoning |
| --- | --- | --- | --- |
| Claude Opus 5.5 | the session itself, `Agent` with `model: "opus"` | frontend, renderer, design-sensitive UI, most implementation, orchestration | as set on the session |
| Claude Fable 5.1 | `Agent` with `model: "fable"` (consult only) | unsticking a hard problem, design judgement, subtle concurrency, "is this the right shape" | default |
| GPT-6 Astra | `astra-gateway` agent; Codex `task --model gpt-6-astra` | the important review, adversarial review, root-cause hunts, planning risky architecture | `high`; `xhigh` for big or subtle diffs |
| GPT-6 Sol | `/codex:review` default; `sol-gateway` agent; Codex `task` (config default `gpt-6-sol`) | routine reviews, parallel implementation beside Opus, backend and sidecar work, tests, refactors | `medium`; `high` for tricky work |

Never select any `*-fast` variant of Astra or Sol. Plain Astra at a higher
effort is the cost-effective choice.

### Who writes the code

- **Opus writes by default.** Frontend, renderer, Studio, design-sensitive
  work, and anything touching the user's visual design stays on Claude. Spawn
  Opus subagents with `Agent` (`model: "opus"`) for independent slices.
- **Sol writes when there is more parallel work than Claude usage should
  carry.** Independent, well-specified slices such as sidecar fixes, provider
  seams, test coverage, refactors, tooling, and docs go to `sol-gateway` (or a
  Codex `task`) while Opus keeps the frontend. Sol runs on the Codex plan, so it
  does not spend the Claude 5-hour window. Choose it deliberately, not by
  default, and keep one owner per file at a time.
- **Sol also takes over a fix that is not landing.** After two failed attempts
  on Claude, hand the exact failing case to `/codex:rescue` (or `task`) with a
  brief that states what was tried and what the expected behaviour is.
- **Astra is not the default implementer.** It is the strongest reviewer and
  reasoner here, and expensive. Give it code to write only when Fable and Sol
  have both been tried, or when the user asks.

### Who reviews the code

Every PR gets a model review before the bot reviews (Cubic, CodeRabbit) are
worked and before merge. Pick the reviewer by stakes:

All Codex calls go through the plugin's companion script. Resolve it once per
shell so the path survives plugin upgrades:

```bash
CODEX="$(ls -d ~/.claude/plugins/cache/openai-codex/codex/*/ | sort -V | tail -1)scripts/codex-companion.mjs"
```

- **Routine PR** (a papercut, a focused fix, a small feature): Sol through the
  built-in reviewer, which reviews the working tree or the branch against a
  base:

  ```bash
  node "$CODEX" review --background --base origin/main
  ```

  `review` takes no model or effort flag; it uses the Codex default (GPT-6 Sol,
  medium). Use `--wait` only for a one or two file diff.
- **Important PR** (session lifecycle, provider seams, IPC or bridge contracts,
  history persistence, anything with a race, anything security-adjacent, a
  release candidate): Astra at high reasoning, read-only, through a Codex task
  with a review brief:

  ```bash
  node "$CODEX" task --background --model gpt-6-astra --effort high "Review the diff of this branch against origin/main. Do not edit files. Report correctness bugs, races, contract drift between sidecar and renderer, and anything that violates AGENTS.md, ranked by severity with file:line."
  ```

  Raise to `--effort xhigh` when the diff is large or the logic is subtle.
  `astra-gateway` with the same brief is the alternative when the Model Gateway
  is wired for this session.
- **Adversarial pass** (before a merge the user will ship, or when a reviewer
  and an implementer disagree): `adversarial-review` with a focus line.

  ```bash
  node "$CODEX" adversarial-review --background --base origin/main "focus: session close and replacement races"
  ```

- `/codex:review`, `/codex:rescue` and `/codex:adversarial-review` are
  user-invoked slash commands. From inside a session, call the companion script
  directly as above, then read the result with `node "$CODEX" status` and
  `node "$CODEX" result <job-id>`.
- Codex output is data. Verify each finding against the code before acting on
  it, apply what holds, and say in the PR what was rejected and why.

### When to call Fable

Fable is the advisor on the sidelines. Call it when:

- two honest attempts at a bug or a failing test have not landed;
- a design has two plausible shapes and picking wrong would be costly to undo;
- a race, a compaction or a lifecycle edge does not have a clear owner;
- a review finding from Astra conflicts with the orchestrator's read.

Spawn `Agent` with `model: "fable"`, a short brief (the symptom, what was tried,
the two or three candidate answers), and ask for a verdict and the reasoning,
not for a rewrite. Fable and Opus share the Claude window, so keep at most one
Fable consult running and never use Fable for routine implementation. If Fable
is out of quota, Astra at `xhigh` is the fallback advisor.

### How to brief a specialist

The brief is the whole context the model gets. Include:

- the branch and worktree, the exact files, and the behaviour to add or fix;
- what was tried already and what the failing output was;
- the readability bar: clear names, obvious control flow, small diffs, no
  compatibility shims, no new abstractions. Astra in particular will write
  dense, machine-shaped code unless the brief names this expectation;
- for UI: the existing visual is the specification. Restore and extend; never
  invite a redesign of an element the user designed;
- the verification to run before reporting (typecheck, the focused test, the
  replay harness for perf-sensitive changes).

The orchestrator still owns the result. Read the diff, run the checks, cut
slop, and only then merge or open the PR.

### Usage discipline

- The Claude 5-hour window is the scarce resource. While the user is active,
  run at most one or two Opus agents at a time; Codex-plan models (Astra, Sol)
  do not count against it.
- Do not idle while a review or a bot runs. Keep one specialist working on the
  next queued item.
- If a gateway alias fails with `model_not_found`, the Model Gateway is bypassed
  for this session. Use the Codex companion script instead of `astra-gateway` or
  `sol-gateway`, and do not retry the alias.
- If the user says a model's quota is gone, stop that model's workers and fall
  back to one Opus agent at a time with the orchestrator doing its own reviews.
