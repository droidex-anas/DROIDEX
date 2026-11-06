# Presence slice 2 WIP: perf probe notes (throwaway, not for merge)

Board commits, measured with React Profiler around a component that calls
useSessionLive + useCanvasPresence under the real StoreProvider, in Chromium
(tests/smoke/board/presenceProbe.tmp.*), one flushSync dispatch per event:

- 1000 streamed tokens on the board's chat, presence unchanged: 0 commits
- 1000 streamed tokens on another chat: 0 commits
- 20 non-canvas tool call/result pairs on the board's chat: 0 commits
- each presence change (write starts, second write starts, write lands): 1 commit, ~0.1 ms

Selector cost per store update (presence-probe.tmp.ts, Node 22, real reducer,
1000 deltas, after warm-up):

| agents | turn events | before (indexed walk back) median / p95 | after (forward iterator) median / p95 |
| --- | --- | --- | --- |
| 4 | 133 | 56 / 94 µs | 9.0 / 11.3 µs |
| 16 | 529 | 233 / 288 µs | 35 / 63 µs |
| 16 + 1500 earlier events | 2029 | n/a | 98 / 138 µs |

Cause of the "before" cost: transcripts are chunked-sequence proxies; indexed
reads go through the proxy's get trap (~0.25 µs each). Iterating avoids it.

Multi-agent replay (sidecar only, does not load the renderer): all budgets and
hard gates pass; append->client p95 54.70 ms (budget 55), event-loop p95 12.51 ms.
