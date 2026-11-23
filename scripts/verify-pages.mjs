import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import { createHash } from 'node:crypto';
import worker from '../dist/_worker.js';

const origin = 'https://test.invalid';
test('Pages serves compiled demo entry, engine and current favicon', async () => {
  const home = await worker.fetch(new Request(origin), {});
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /data-static-demo/);
  assert.match(html, /href="\/favicon.svg"/);
  for (const [path, type] of [['/app.js', 'text/javascript'], ['/lib/engine.mjs','text/javascript'], ['/favicon.svg','image/svg+xml']]) {
    const res = await worker.fetch(new Request(origin + path), {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type').split(';')[0], type);
  }
});

test('Klat rejects unauthorized requests and relays synthetic messages using a mocked upstream', async () => {
  const token = '1'.repeat(40);
  const digest = createHash('sha256').update(token).digest('hex');
  const source = await readFile(new URL('../dist/_worker.js', import.meta.url), 'utf8');
  const fixture = source.replace(/const inviteDigest = '[0-9a-f]{64}';/, "const inviteDigest = '" + digest + "';");
  assert.notEqual(source, fixture, 'synthetic test invite installed in the in-memory fixture');
  const { default: adapter } = await import('data:text/javascript;base64,' + Buffer.from(fixture).toString('base64'));
  const room = crypto.randomUUID();
  const base = '/v1.4/api/channels/cvd-' + room;
  const messages = [];
  let exists = false;
  const upstream = mock.method(globalThis, 'fetch', async (url, opts) => {
    const { origin: host, pathname } = new URL(url);
    assert.equal(host, 'https://api.talkplus.io');
    assert.equal(opts.headers['api-key'], 'local-fixture');
    assert.equal(opts.redirect, 'manual');
    const body = opts.body && JSON.parse(opts.body);
    if (pathname === '/v1.4/api/channels/create' && opts.method === 'POST') {
      assert.equal(body.type, 'private');
      assert.equal(body.channelId, 'cvd-' + room);
      exists = true;
    } else if (!exists && pathname === base) {
      return Response.json({ error:true, code:'2003' }, { status: 404 });
    } else if (pathname === base + '/messages/admin/send' && opts.method === 'POST') {
      messages.unshift(body);
      return Response.json({ message:body });
    } else if (pathname === base + '/messages' && opts.method === 'GET') {
      return Response.json({ messages });
    } else if (pathname === base && opts.method === 'DELETE') {
      exists = false;
    } else {
      throw Error('Unexpected request to mock upstream');
    }
    return Response.json({});
  });
  const call = (method, body, bearer = token) => adapter.fetch(new Request(origin + '/api/klat/' + room, {
    method, headers:{ Authorization:'Bearer ' + bearer, 'Content-Type':'application/json' },
    body: body && JSON.stringify(body)
  }), { KLAT_API_KEY: 'local-fixture' });
  try {
    assert.equal((await call('PUT', undefined, 'wrong')).status, 403);
    assert.equal(upstream.mock.callCount(), 0);
    assert.equal((await call('PUT')).status, 200);
    for (const role of ['guardian','reception']) assert.equal((await call('POST', { role, text: role })).status, 201);
    assert.deepEqual(await (await call('GET')).json(), ['guardian','reception'].map(role => ({role, text:role})));
    assert.equal((await call('DELETE')).status, 200);
    assert.equal(exists, false);
  } finally {
    upstream.mock.restore();
  }
});
