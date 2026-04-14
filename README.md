# @raphaelbgr/subproc-safe

Safe subprocess wrapper for Node.js. Always-timeout, tree-kill, TTL cache + single-flight, optional GPU query, non-blocking leak reporting.

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
