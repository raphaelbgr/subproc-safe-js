# @raphaelbgr/subproc-safe

Safe subprocess wrapper for Node.js. Always-timeout, tree-kill, TTL cache + single-flight, optional GPU query, non-blocking leak reporting.

## Install

Not published to npm. Pin to a git tag for reproducibility.

```
npm install github:raphaelbgr/subproc-safe-js#v0.1.1
```

```js
import { run, runCached, gpuQuery, LeakReportClient } from '@raphaelbgr/subproc-safe';

const r = await run(['echo', 'hi'], { timeout: 5000 }); // timeout REQUIRED (ms)
const c = await runCached(['slow'], { timeout: 30000, cacheTtl: 60000 });
```

- `timeout` (ms) is mandatory.
- On timeout the whole descendant tree is killed via `tree-kill`.
- `shell: true` is banned.
- `runCached` coalesces concurrent identical calls via mutex + TTL.
- `LeakReportClient` fire-and-forgets POSTs (500 ms); never throws.

## Rules enforced

Origin: [avell-i7 2026-04-14 subprocess-leak postmortem](https://github.com/raphaelbgr/subproc-safe-js).

| # | Rule | Enforcement |
|---|------|-------------|
| 1 | **Mandatory timeout** — every call must specify a timeout; no accidental forever-hangs. | **LIB** — `run()` throws `TypeError` if `timeout` is absent. |
| 2 | **Windows console suppress** — `windowsHide: true` prevents flash console windows from headless Node parents. | **LIB** — injected automatically on every `spawn` call; no-op on POSIX. |
| 3 | **TTL cache + single-flight** — repeated identical calls within a TTL window collapse into one subprocess. | **LIB** — `runCached(cmd, { timeout, cacheTtl })`. |
| 4 | **Prefer in-process bindings** — native Node bindings (`child_process` alternatives, SDK clients) are always faster and safer than spawning. | **CALLER** — document the choice; use `run()` only when no binding exists. |
| 5 | **Single-instance lock per service** — prevent duplicate daemon spawns with a pid-file or advisory lock. | **CALLER** — out of library scope; implement in your service entrypoint. |
| 6 | **One chokepoint wrapper per service** — all subprocesses for a service flow through a single call site. | **LIB** — this library *is* that chokepoint; import it everywhere instead of calling `child_process` directly. |
| 7 | **SSH multiplexing** — reuse `ControlMaster` connections to avoid per-command TCP handshakes. | **INFRA** — configure in `~/.ssh/config`; out of library scope. |
