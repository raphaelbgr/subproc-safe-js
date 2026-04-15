/**
 * Edge-case tests for subproc-safe (Node built-in test runner).
 *
 * Each test is self-contained. Cache-touching tests use unique cacheKey values
 * so they never share state across tests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { run, runCached, LeakReportClient, ValueError, _resetCacheForTests } from '../src/index.js';

// -------------------------------------------------------------------------
// 1. check:true with nonzero exit raises Error with exitCode === 1
// -------------------------------------------------------------------------

test('check:true nonzero exit raises with exitCode 1', async () => {
  const cmd = ['node', '-e', 'process.exit(1)'];
  await assert.rejects(
    () => run(cmd, { timeout: 5000, check: true }),
    (err) => {
      assert.ok(err instanceof Error, 'must be an Error');
      assert.ok(err.result, 'error must have .result');
      assert.equal(err.result.exitCode, 1);
      return true;
    }
  );
});

// -------------------------------------------------------------------------
// 2. Zero / negative timeout rejected
// -------------------------------------------------------------------------

test('timeout:0 is rejected', async () => {
  // The impl passes timeout straight to setTimeout(cb, 0) which fires
  // immediately — the process will always time out. Either a TimeoutError or
  // a TypeError/ValueError from the impl is acceptable; a silent success is not.
  let threw = false;
  try {
    await run(['node', '-e', 'setTimeout(()=>{},10000)'], { timeout: 0, check: false });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'timeout:0 must not silently succeed');
});

test('timeout:-1 is rejected', async () => {
  // Negative setTimeout fires immediately (same as 0 in V8). Either a
  // TimeoutError or a TypeError/ValueError is acceptable.
  let threw = false;
  try {
    await run(['node', '-e', 'setTimeout(()=>{},10000)'], { timeout: -1, check: false });
  } catch {
    threw = true;
  }
  assert.ok(threw, 'timeout:-1 must not silently succeed');
});

// -------------------------------------------------------------------------
// 3. Non-array (string) args rejected
// -------------------------------------------------------------------------

test('string args rejected with ValueError', async () => {
  await assert.rejects(
    () => run('echo x', { timeout: 5000 }),
    (err) => err instanceof ValueError || err instanceof TypeError
  );
});

// -------------------------------------------------------------------------
// 4. Empty args array rejected
// -------------------------------------------------------------------------

test('empty args array rejected', async () => {
  await assert.rejects(
    () => run([], { timeout: 5000 }),
    (err) => err instanceof ValueError || err instanceof TypeError
  );
});

// -------------------------------------------------------------------------
// 5. cwd is respected
// -------------------------------------------------------------------------

test('cwd option is respected', async () => {
  const dir = os.tmpdir();
  // node -e writes cwd to stdout
  const code = `process.stdout.write(require('path').resolve(process.cwd()))`;
  const r = await run(['node', '-e', code], { timeout: 5000, cwd: dir });
  // On macOS os.tmpdir() may be /var/folders/... but process.cwd() inside the
  // child may resolve to /private/var/... — use fs.realpathSync to normalise.
  const realDir = fs.realpathSync(dir);
  assert.equal(r.stdout.trim(), realDir);
});

// -------------------------------------------------------------------------
// 6. env is respected
// -------------------------------------------------------------------------

test('env option is respected', async () => {
  const code = `process.stdout.write(process.env.FOO_EDGE_TEST || 'MISSING')`;
  const r = await run(['node', '-e', code], {
    timeout: 5000,
    env: { FOO_EDGE_TEST: 'bar_xyz', PATH: process.env.PATH || '' },
  });
  assert.equal(r.stdout.trim(), 'bar_xyz');
});

// -------------------------------------------------------------------------
// 7. Single-flight exception propagation
//    5 concurrent runCached calls with check:true on a failing command.
//    All must reject; only ONE subprocess should have been spawned.
// -------------------------------------------------------------------------

test('single-flight exception: all callers reject, only one spawn', async () => {
  _resetCacheForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-ec-sf-'));
  const cpath = path.join(dir, 'count');

  const code = `
    const fs = require('fs');
    fs.appendFileSync(${JSON.stringify(cpath)}, 'x');
    process.exit(1);
  `;
  const cmd = ['node', '-e', code];
  const uniqueKey = `sf_exc_edge_${Date.now()}`;

  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      runCached(cmd, {
        timeout: 10000,
        cacheTtl: 60000,
        cacheKey: uniqueKey,
        check: true,
      })
    );
  }

  const settled = await Promise.allSettled(promises);

  // All 5 must have rejected
  for (const s of settled) {
    assert.equal(s.status, 'rejected', `expected rejection, got: ${JSON.stringify(s)}`);
  }

  // Only one subprocess invocation
  let count = 0;
  try {
    count = fs.readFileSync(cpath, 'utf8').length;
  } catch {
    assert.fail('Counter file was never created; subprocess may not have run at all');
  }
  assert.equal(count, 1, `expected 1 spawn, got ${count}`);
});

// -------------------------------------------------------------------------
// 8. LeakReportClient.flush() awaits all pending posts
// -------------------------------------------------------------------------

test('LeakReportClient.flush() delivers all 10 pending reports', async () => {
  const received = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d.toString(); });
    req.on('end', () => {
      try { received.push(JSON.parse(body)); } catch {}
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const { port } = srv.address();

  try {
    const client = new LeakReportClient({
      endpoint: `http://127.0.0.1:${port}/leak`,
      enabled: true,
    });

    for (let i = 0; i < 10; i++) {
      client.report({
        caller: `test:${i}`,
        args: ['node', '-e', 'null'],
        pid: i,
        cwd: '/tmp',
        startedAt: Date.now(),
        durationMs: 1,
        exitCode: 0,
      });
    }

    await client.flush();
    assert.equal(received.length, 10, `expected 10 reports, got ${received.length}`);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

// -------------------------------------------------------------------------
// 9. Large stdout does not deadlock
// -------------------------------------------------------------------------

test('5MB stdout does not deadlock', async () => {
  const code = `process.stdout.write('x'.repeat(5_000_000))`;
  const r = await run(['node', '-e', code], { timeout: 30000 });
  assert.ok(
    r.stdout.length >= 5_000_000,
    `expected >= 5000000 bytes, got ${r.stdout.length}`
  );
});
