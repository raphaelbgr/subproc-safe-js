import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gpuQuery, NoGPUError } from '../src/index.js';

test('gpuQuery raises NoGPUError on mac/no nvidia-smi', async () => {
  // This host has no NVIDIA GPU / no nvidia-smi binary. Expect NoGPUError.
  await assert.rejects(() => gpuQuery(), (err) => err instanceof NoGPUError);
});
