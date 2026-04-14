import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, TimeoutError, ValueError } from '../src/index.js';

test('missing timeout throws TypeError', async () => {
  await assert.rejects(() => run(['echo', 'hi'], {}), (err) => err instanceof TypeError);
});

test('shell:true is banned', async () => {
  await assert.rejects(() => run(['echo', 'hi'], { timeout: 1000, shell: true }),
    (err) => err instanceof ValueError);
});

test('basic run captures stdout', async () => {
  const r = await run(['node', '-e', "process.stdout.write('hello')"], { timeout: 5000 });
  assert.equal(r.exitCode, 0);
  assert.ok(r.stdout.includes('hello'));
});

test('timeout kills tree within ~2s', async () => {
  const t0 = Date.now();
  await assert.rejects(
    () => run(['node', '-e', 'setTimeout(()=>{}, 30000)'], { timeout: 500 }),
    (err) => err instanceof TimeoutError
  );
  const dt = Date.now() - t0;
  assert.ok(dt < 3000, `took too long: ${dt}ms`);
});

test('check:false returns nonzero', async () => {
  const r = await run(['node', '-e', 'process.exit(7)'], { timeout: 5000, check: false });
  assert.equal(r.exitCode, 7);
});
