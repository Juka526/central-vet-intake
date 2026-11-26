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

test('Pages forwards only the invited visit routes and required headers to Cloud Run', async () => {
  const config = { INTAKE_API_ORIGIN: 'https://fixture.run.app' };
  const id = crypto.randomUUID();
  const path = '/api/intakes/' + id + '/review';
  const upstream = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, config.INTAKE_API_ORIGIN + path);
    assert.equal(options.redirect, 'manual');
    assert.equal(options.method, 'POST');
    assert.deepEqual(Object.fromEntries(options.headers), {
      'content-type': 'application/json', 'x-demo-role': 'vet',
      'x-serverless-authorization': 'Bearer synthetic-id-token',
    });
    assert.deepEqual(await new Response(options.body).json(), { version: 1 });
    return Response.json({ version: 2 }, { headers: { 'Set-Cookie': 'upstream=discard' } });
  });
  const call = (target, headers = {}) => worker.fetch(new Request(origin + target, {
    method: 'POST', headers, body: JSON.stringify({ version: 1 }),
  }), config);
  try {
    assert.equal((await call(path)).status, 401);
    assert.equal((await call(path, { Origin: 'https://other.invalid' })).status, 403);
    assert.equal((await call('/api/intakes/unexpected', { Authorization: 'Bearer synthetic-id-token' })).status, 404);
    assert.equal(upstream.mock.callCount(), 0);
    const result = await call(path, {
      Authorization: 'Bearer synthetic-id-token', 'Content-Type': 'application/json', 'X-Demo-Role': 'vet',
      Cookie: 'local=discard', 'X-Serverless-Authorization': 'Bearer discarded', 'X-Forwarded-User': 'discard',
    });
    assert.equal(result.status, 200);
    assert.equal(result.headers.has('Set-Cookie'), false);
    assert.deepEqual(await result.json(), { version: 2 });
  } finally {
    upstream.mock.restore();
  }
});

test('Pages forwards authenticated audio bytes and rejects unexpected media', async () => {
  const config = { INTAKE_API_ORIGIN: 'https://fixture.run.app' };
  const path = '/api/intakes/' + crypto.randomUUID() + '/audio';
  const bytes = new Uint8Array([79, 103, 103, 83, 0, 255]);
  let type = 'audio/ogg';
  const upstream = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, config.INTAKE_API_ORIGIN + path);
    assert.equal(options.headers.get('X-Serverless-Authorization'), 'Bearer synthetic-id-token');
    assert.equal(options.headers.get('X-Demo-Role'), 'vet');
    return new Response(bytes, { headers: { 'Content-Type': type } });
  });
  const call = () => worker.fetch(new Request(origin + path, {
    headers: { Authorization: 'Bearer synthetic-id-token', 'X-Demo-Role': 'vet' },
  }), config);
  try {
    const response = await call();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), type);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    type = 'text/html';
    assert.equal((await call()).status, 502);
  } finally {
    upstream.mock.restore();
  }
});

test('Pages forwards the cleanup job token through Cloud Run IAM', async () => {
  const path = '/api/intake/audio-cleanup';
  const config = { INTAKE_API_ORIGIN: 'https://fixture.run.app' };
  const upstream = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, config.INTAKE_API_ORIGIN + path);
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.get('X-Serverless-Authorization'), 'Bearer synthetic-job-token');
    return Response.json({ ok: true });
  });
  try {
    const headers = { Authorization: 'Bearer synthetic-job-token' };
    assert.equal((await worker.fetch(new Request(origin + path, { headers }), config)).status, 405);
    assert.equal((await worker.fetch(new Request(origin + path, { headers, method: 'POST' }), config)).status, 200);
  } finally {
    upstream.mock.restore();
  }
});
