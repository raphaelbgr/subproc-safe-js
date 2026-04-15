import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('windowsHide: true is present in src/index.js source', async () => {
  const src = await readFile(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /windowsHide:\s*true/, 'src/index.js must set windowsHide: true for Windows console suppression (Rule 2)');
});
