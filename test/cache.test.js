import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCached, _resetCacheForTests } from '../src/index.js';

function counterCmd(cpath) {
  const code = `require('fs').appendFileSync(${JSON.stringify(cpath)}, 'x'); console.log('ran');`;
  return ['node', '-e', code];
}

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ss-')), 'c');
}

test('cache hit skips subprocess', async () => {
  _resetCacheForTests();
  const cpath = tmpFile();
  const cmd = counterCmd(cpath);
  const a = await runCached(cmd, { timeout: 5000, cacheTtl: 60000 });
  const b = await runCached(cmd, { timeout: 5000, cacheTtl: 60000 });
  assert.equal(a.stdout, b.stdout);
  assert.equal(fs.readFileSync(cpath, 'utf8'), 'x');
});

test('ttl expiry respawns', async () => {
  _resetCacheForTests();
  const cpath = tmpFile();
  const cmd = counterCmd(cpath);
  await runCached(cmd, { timeout: 5000, cacheTtl: 100 });
  await new Promise((r) => setTimeout(r, 200));
  await runCached(cmd, { timeout: 5000, cacheTtl: 100 });
  assert.equal(fs.readFileSync(cpath, 'utf8'), 'xx');
});

test('cache key override separates entries', async () => {
  _resetCacheForTests();
  const cpath = tmpFile();
  const cmd = counterCmd(cpath);
  await runCached(cmd, { timeout: 5000, cacheTtl: 60000, cacheKey: 'A' });
  await runCached(cmd, { timeout: 5000, cacheTtl: 60000, cacheKey: 'B' });
  assert.equal(fs.readFileSync(cpath, 'utf8'), 'xx');
});
