import { spawn } from 'node:child_process';
import treeKill from 'tree-kill';

export class TimeoutError extends Error {
  constructor(msg) { super(msg); this.name = 'TimeoutError'; }
}
export class NoGPUError extends Error {
  constructor(msg) { super(msg); this.name = 'NoGPUError'; }
}
export class LeakError extends Error {
  constructor(msg) { super(msg); this.name = 'LeakError'; }
}
export class ValueError extends Error {
  constructor(msg) { super(msg); this.name = 'ValueError'; }
}

export async function run(args, opts = {}) {
  if (!opts || typeof opts !== 'object') {
    throw new TypeError('run(args, opts): opts object required');
  }
  const { timeout, cwd, env, check = true, shell = false, _leakClient = null } = opts;
  if (shell === true) {
    throw new ValueError('shell=true is banned in subproc-safe run()');
  }
  if (timeout === undefined || timeout === null) {
    throw new TypeError('run(): required option "timeout" (ms) missing');
  }
  if (!Array.isArray(args) || args.length === 0) {
    throw new ValueError('args must be a non-empty array');
  }

  const started = Date.now();
  return await new Promise((resolve, reject) => {
    const child = spawn(args[0], args.slice(1), {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    let timedOut = false;
    const tid = setTimeout(() => {
      timedOut = true;
      treeKill(child.pid, 'SIGTERM', () => {
        setTimeout(() => {
          try { treeKill(child.pid, 'SIGKILL', () => {}); } catch {}
        }, 1000);
      });
    }, timeout);

    child.on('error', (err) => {
      clearTimeout(tid);
      reject(err);
    });

    child.on('close', (code, signal) => {
      clearTimeout(tid);
      const durationMs = Date.now() - started;
      if (_leakClient) {
        try {
          _leakClient.report({
            caller: 'unknown',
            args,
            pid: child.pid,
            cwd: cwd || process.cwd(),
            startedAt: started,
            durationMs,
            exitCode: timedOut ? null : code,
          });
        } catch {}
      }
      if (timedOut) {
        reject(new TimeoutError(`command timed out after ${timeout}ms: ${args.join(' ')}`));
        return;
      }
      const result = { stdout, stderr, exitCode: code, signal, durationMs };
      if (check && code !== 0) {
        const err = new Error(`command failed (exit ${code}): ${args.join(' ')}`);
        err.result = result;
        reject(err);
        return;
      }
      resolve(result);
    });
  });
}

// ---- cache + single-flight ----
const _cache = new Map();

export async function runCached(args, opts = {}) {
  const { timeout, cacheTtl, cacheKey = null, cwd, env, check = true } = opts;
  if (cacheTtl === undefined) throw new TypeError('runCached: cacheTtl (ms) required');
  const key = JSON.stringify([args, cwd || null, cacheKey]);

  const entry = _cache.get(key);
  const now = Date.now();
  if (entry && entry.value && now < entry.expiresAt) {
    return entry.value;
  }
  if (entry && entry.pending) {
    return await entry.pending;
  }

  const slot = entry || {};
  slot.pending = (async () => {
    try {
      const cp = await run(args, { timeout, cwd, env, check });
      slot.value = cp;
      slot.expiresAt = Date.now() + cacheTtl;
      return cp;
    } finally {
      slot.pending = null;
    }
  })();
  _cache.set(key, slot);
  return await slot.pending;
}

export function _resetCacheForTests() {
  _cache.clear();
}

// ---- GPU query ----
export async function gpuQuery() {
  let mod;
  try {
    mod = await import('nvidia-smi-gpu');
  } catch (e) {
    throw new NoGPUError(`nvidia-smi-gpu not installed: ${e.message}`);
  }
  // Fallback: invoke nvidia-smi directly as JSON-ish output
  try {
    const out = await run(
      ['nvidia-smi',
        '--query-gpu=index,name,memory.total,memory.free,memory.used,utilization.gpu,utilization.memory,temperature.gpu',
        '--format=csv,noheader,nounits'],
      { timeout: 5000, check: true }
    );
    const lines = out.stdout.trim().split('\n').filter(Boolean);
    return lines.map((ln) => {
      const [index, name, mt, mf, mu, ug, um, tc] = ln.split(',').map((s) => s.trim());
      return {
        index: parseInt(index, 10),
        name,
        memTotalMB: parseInt(mt, 10),
        memFreeMB: parseInt(mf, 10),
        memUsedMB: parseInt(mu, 10),
        utilGpuPct: parseInt(ug, 10),
        utilMemPct: parseInt(um, 10),
        tempC: parseInt(tc, 10),
      };
    });
  } catch (e) {
    throw new NoGPUError(`nvidia-smi query failed: ${e.message}`);
  }
}

// ---- Leak report ----
export class LeakReportClient {
  constructor({ endpoint, enabled = true } = {}) {
    this.endpoint = endpoint || process.env.SUBPROC_SAFE_LEAK_ENDPOINT || null;
    this.enabled = enabled && !!this.endpoint;
    this._pending = new Set();
  }

  report(event) {
    if (!this.enabled) return;
    const p = this._post(event).catch(() => {}).finally(() => this._pending.delete(p));
    this._pending.add(p);
  }

  async _post(event) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 500);
    try {
      await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(event),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(tid);
    }
  }

  async flush() {
    await Promise.allSettled([...this._pending]);
  }
}
