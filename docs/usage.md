# Local usage ledger

DROIDEX records token metadata and the set of sessions it owns in one
profile-scoped SQLite database. Harness
logs remain the evidence used for ingestion; `usage.sqlite` is the canonical
normalized history used by the desktop profile, Remote, and public profile
snapshots. Prompt text, responses, tool arguments, workspace paths, API keys,
and raw log records never cross the aggregate profile API. The ledger stores
only usage metadata; local source and project paths remain inside cursor and
session rows on the laptop.

## Ownership

The Node sidecar owns the database through a dedicated worker thread. Parsing,
directory reconciliation, SQLite writes, rollup rebuilds, and profile queries
therefore cannot block Electron rendering or the encrypted Remote host. The
renderer never reads a harness log or sends usage counters back to the sidecar.

The database is `usage.sqlite` inside the DROIDEX profile directory. An
isolated development profile gets an isolated ledger. Only one worker writes
it; readers use aggregate snapshots returned through the authenticated local
bridge.

## Ingestion

Each supported harness adapter discovers only its documented local data root.
Claude Code and Codex JSONL sources are read from the last committed complete
newline. Their cursor stores the canonical source path, file identity, size,
modification time, a SHA-512 guard over the bytes before the offset, and the
parser version and reducer state. The guard detects tail rewrites without
retaining prompt bytes; file identity, size and modification metadata cover
rotation, truncation and same-size replacement.

Factory Droid is read from the mutable `~/.factory/sessions/**/*.settings.json`
metadata files. The adapter uses each file's own `tokenUsage`, never
`inclusiveTokenUsage`, so parent sessions do not count child-agent usage twice.
It persists the last cumulative totals and emits only monotonic deltas. A file
replacement or decrease in any raw counter starts a new generation. Last-known
baselines survive temporarily absent counters, so a known value cannot be
counted twice when it reappears. Recursive discovery streams lexicographic,
resumable filename pages without retaining or capping unrelated directory
entries. Every process drains one complete startup sweep before Droid is marked
ready. An exact-path watcher prioritizes changed settings, while the rotating
bounded sweep recovers missed events. A size, modification-time, and
file-identity match skips unchanged content; a periodic audit still verifies
its canonical metadata hash. That hash covers only model and token fields,
never unrelated settings values. A file that changes while being read gets one
immediate retry, then exponential backoff capped at 60 seconds; discovery still
advances past it so one active session cannot starve the others.

OpenCode is read directly from its own SQLite database in read-only,
`query_only` mode. The adapter captures a row-ID high-water mark, reads bounded
pages, and commits a per-table row cursor after every page. Assistant rows are
ingested only after OpenCode marks them complete. A bounded set of unfinished
row IDs is persisted with the cursor and revisited because OpenCode updates
those rows in place as a turn finishes. A live write therefore lands in the
current bounded pass or a later one without holding a snapshot transaction
open or recording partial token counts. Each pass reads at most 8 MiB by
default, closes every statement snapshot after its bounded page, and rotates
the next starting database so a busy primary database cannot starve another.

Watcher events wake reconciliation or prioritize an exact Droid settings file.
Startup and periodic reconciliation remain authoritative, so dropped or
coalesced filesystem notifications do not lose usage. JSONL files that exceed a
single read slice stay on a bounded pending queue until their committed tail is
drained. JSONL watcher paths are deduplicated in a 4,096-entry queue, share each
pass fairly with deferred files and discovery, and fall back to a complete scan
every 60 seconds. Symlinks are not followed. Reads, line sizes, queues, and
batches are bounded. A partial final line waits for the next append. Once a line exceeds the
record limit, the cursor durably enters discard mode and advances in bounded
chunks until its newline, so a restart cannot parse a suffix as a new record.
Invalid complete lines are skipped without retaining or logging their content.

Normalized events and their next cursor commit in one SQLite transaction. A
crash can roll back both, allowing the source bytes to be read again. Every
adapter supplies a harness-specific dedupe key and `usage_event` enforces its
uniqueness, so rereads, rotation, copied logs, and overlapping wakeups do not
double count.

## Token semantics

Token columns are nullable. `NULL` means the harness did not report that
category; zero is stored only when the harness proves the count is zero.

- `input_tokens` is total input-side usage, including cached input.
- `cache_read_tokens` and `cache_write_tokens` are subsets of input tokens.
- `output_tokens` includes reasoning output.
- `reasoning_tokens` is a subset of output tokens.

Total tokens are `input_tokens + output_tokens`; cache and reasoning columns
must not be added again. Aggregate rows retain known sums and unknown-event
counts so the UI can say “measured” or “incomplete” rather than presenting an
unknown category as zero.

## Storage model

`usage_event` is append-only and protected against update and delete. It holds
UTC timestamps, harness/model/session identifiers, normalized token buckets,
and optional provider-reported cost metadata. It contains no display text from
the source transcript.

`droidex_session` is a second append-only source-of-truth table containing one
stable top-level DROIDEX `appSessionId` per row and no other columns. Startup
seeds it from the canonical top-level history index. Every successfully created
or resumed session is then inserted idempotently after its history row is
durable. Child sessions, prompts, paths, titles, timestamps, and transcript
content never enter this table. The profile headline session count comes only
from this table, so an empty DROIDEX chat still counts while an external harness
session does not.

The remaining tables support that event log:

- `harness` names current and external harnesses without constraining them to
  the three providers that can launch inside DROIDEX.
- `usage_session` namespaces session identifiers by harness.
- `usage_session_model` is a rebuildable distinct set used only for per-harness
  and per-model usage-session rankings without rescanning raw events.
- `ingest_cursor` makes JSONL reads incremental and restartable.
- `usage_source_cursor` stores opaque, versioned cursors for structured sources
  such as OpenCode SQLite and Factory Droid settings.
- `model_price` stores effective-dated API prices.
- `usage_daily` is a rebuildable chart cache for the active IANA time zone.
- `rollup_state` records the time zone and source event count used by derived
  data.

Daily keys use the user’s current IANA time zone, while raw timestamps stay in
UTC milliseconds. A time-zone change rebuilds daily rows from the event log so
travel and daylight-saving changes do not permanently mis-bucket activity.

SQLite runs in WAL mode with foreign keys, `synchronous=NORMAL`, and a bounded
busy timeout. The write transaction uses `BEGIN IMMEDIATE`. The raw event log
is never capped or pruned silently; derived rollups can be dropped and rebuilt.

## Cost

Provider-reported cost and calculated cost are distinct. Both use integer
micro-USD amounts so aggregation does not accumulate floating-point error.
The bundled catalog uses exact model IDs, effective dates, and standard global
API rates. Calculated cost remains unknown for an unrecognized alias or tier,
an unsupported long-context price, incomplete token buckets, or an ambiguous
cache-write duration. This avoids silently applying the wrong price. Any
calculated cost shown for a subscription harness is labeled **API-equivalent
estimate**; it is not a claim about the user’s bill.

Raw events keep the pricing snapshot recorded at ingestion. Rebuilding the
derived daily cache uses the current effective-dated catalog, so a corrected
catalog fixes every aggregate consistently without rewriting append-only event
history. Provider-reported cost remains a separate authoritative column.

[`ccusage`](https://github.com/ccusage/ccusage) remains a useful reference and
optional cross-check, but DROIDEX does not shell out to it or rescan every log
for each view. [T3 Code’s usage
reader](https://github.com/pingdotgg/t3code/blob/7ac952c630ef8a60d14ca8f6a0c7adce33db4bae/apps/server/src/usage/usageTranscriptReader.ts)
informed the guarded byte resume, while its [OpenCode
adapter](https://github.com/pingdotgg/t3code/blob/7ac952c630ef8a60d14ca8f6a0c7adce33db4bae/packages/provider-opencode/src/server/usage.ts)
informed bounded row paging. DROIDEX adds a canonical append-only event ledger
and commits each normalized event batch with its next cursor, so every UI reads
one consistent source instead of provider files.

## Profile and sharing boundary

The local profile API returns aggregates only: activity days, streaks, known
token totals and completeness, API-equivalent cost, and harness/model rankings.
Its headline session count is the number of durable top-level sessions DROIDEX
has created or resumed; ranking session counts remain usage-bearing harness
sessions. The API never returns either kind of session identifier.
It also reports whether JSONL, OpenCode, and Droid indexing is still running,
complete, or failed. The UI must not publish or present a partial snapshot as a
finished profile. One adapter failure does not stop the other adapters or make
the local database unavailable. Source paths, session identifiers, project
names, cursor state, and source error details never cross the API.

Public profile links use a second strict allowlist containing the chosen name,
public username, generated time, headline counts, daily token totals, explicit
token-coverage flags, and up to five harness and model rankings. Those flags let
the viewer label partial counts as measured minimums. Cost, internal coverage
diagnostics, event counts, time zone, projects, sessions, paths, and source
status are removed. The laptop signs the compact payload with the username owner
key only after Remote identity and authenticator setup are complete. Explicit
publish and update operations send that signed public aggregate to the handle's
relay object, which stores only the current payload and signature beside the
existing public owner key. The encoded payload is capped at 20 KiB.

The fixed `/public/<username>` route fetches the bounded bundle from the relay.
The static web client verifies the username-owner signature before rendering and
gives the viewer no route into the laptop. The page remains viewable while the
laptop is offline. The same verified, allowlisted data drives the client-side
PNG share-card renderer without reading the ledger or contacting the laptop.

Publishing is opt-in, updating is explicit, and an owner-signed exact-current
delete removes the relay copy. Revocation prevents future views but cannot erase
downloaded cards or screenshots. Rich per-user social previews still require a
separate dynamic image or metadata endpoint; they must consume only this same
verified public allowlist.

Trusted Remote devices request the same bounded aggregate snapshot over their
existing end-to-end encrypted channel. Usage is sent only on request, never on
the frequent live-task snapshot path.

## Recovery

The worker validates the exact schema contract when it opens. It fails visibly
instead of deleting, recreating, or migrating an unknown database. Back up
`usage.sqlite` together with its `-wal` and `-shm` files before repair. A future
user-invoked reset must close the worker and move all three files to a
timestamped backup before creating an empty ledger.

Parser-version changes cannot silently reinterpret existing canonical events.
If an adapter change needs historical replacement rather than deduped replay,
ship an explicit rebuild operation from retained source logs or change the
event model to record supersession. Do not update old events in place.
