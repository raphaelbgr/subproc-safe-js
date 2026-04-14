import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCached, _resetCacheForTests } from '../src/index.js';

test('100 concurrent calls spawn exactly one child', async () => {
  _resetCacheForTests();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-sf-'));
  const cpath = path.join(dir, 'c');
  const code = `require('fs').appendFileSync(${JSON.stringify(cpath)}, 'x'); setTimeout(()=>console.log('ok'), 200);`;
  const cmd = ['node', '-e', code];

  const promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(runCached(cmd, { timeout: 10000, cacheTtl: 60000 }));
  }
  const results = await Promise.all(promises);
  for (const r of results) assert.equal(r.exitCode, 0);
  const contents = fs.readFileSync(cpath, 'utf8');
  assert.equal(contents, 'x', `expected single spawn, got "${contents}"`);
});
