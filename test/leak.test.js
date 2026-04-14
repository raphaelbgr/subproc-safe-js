import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { LeakReportClient } from '../src/index.js';

test('swallows connection refused', async () => {
  const c = new LeakReportClient({ endpoint: 'http://127.0.0.1:1/leak', enabled: true });
  c.report({ caller: 't', args: ['x'], pid: 0, cwd: '/', startedAt: 0, durationMs: 0, exitCode: 0 });
  await c.flush(); // must not throw
  assert.ok(true);
});

test('successful post sends expected shape', async () => {
  const received = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d.toString(); });
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  try {
    const c = new LeakReportClient({ endpoint: `http://127.0.0.1:${port}/leak`, enabled: true });
    const event = {
      caller: 't.js:1',
      args: ['echo', 'hi'],
      pid: 123,
      cwd: '/tmp',
      startedAt: 1,
      durationMs: 50,
      exitCode: 0,
    };
    c.report(event);
    await c.flush();
    assert.equal(received.length, 1);
    assert.deepEqual(received[0], event);
  } finally {
    srv.close();
  }
});
