import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCached, wasCached, invalidate, invalidatePrefix, clearCache, _resetCacheForTests } from '../src/index.js';

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

// ---------------------------------------------------------------------------
// Cache helper tests
// ---------------------------------------------------------------------------

test('wasCached: true after run, false before', async () => {
  _resetCacheForTests();
  const cpath = tmpFile();
  const cmd = counterCmd(cpath);
  assert.equal(wasCached(cmd), false);
  await runCached(cmd, { timeout: 5000, cacheTtl: 60000 });
  assert.equal(wasCached(cmd), true);
});

test('wasCached: false after TTL expiry', async () => {
  _resetCacheForTests();
  const cpath = tmpFile();
  const cmd = counterCmd(cpath);
  await runCached(cmd, { timeout: 5000, cacheTtl: 100 });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(wasCached(cmd), false);
});

test('invalidate: drops entry, next call respawns', async () => {
  _resetCacheForTests();
  const cpath = tmpFile();
  const cmd = counterCmd(cpath);
  await runCached(cmd, { timeout: 5000, cacheTtl: 60000 });
  assert.equal(wasCached(cmd), true);
  invalidate(cmd);
  assert.equal(wasCached(cmd), false);
  await runCached(cmd, { timeout: 5000, cacheTtl: 60000 });
  assert.equal(fs.readFileSync(cpath, 'utf8'), 'xx');
});

test('invalidatePrefix: drops all matching entries', async () => {
  _resetCacheForTests();
  const cpath1 = tmpFile();
  const cpath2 = tmpFile();
  const cmd1 = counterCmd(cpath1);
  const cmd2 = counterCmd(cpath2);
  await runCached(cmd1, { timeout: 5000, cacheTtl: 60000 });
  await runCached(cmd2, { timeout: 5000, cacheTtl: 60000 });
  assert.equal(wasCached(cmd1), true);
  assert.equal(wasCached(cmd2), true);
  // Both commands start with 'node' — bust all node entries
  invalidatePrefix(['node']);
  assert.equal(wasCached(cmd1), false);
  assert.equal(wasCached(cmd2), false);
});

test('clearCache: drops all entries', async () => {
  _resetCacheForTests();
  const cpath = tmpFile();
  const cmd = counterCmd(cpath);
  await runCached(cmd, { timeout: 5000, cacheTtl: 60000 });
  assert.equal(wasCached(cmd), true);
  clearCache();
  assert.equal(wasCached(cmd), false);
});
