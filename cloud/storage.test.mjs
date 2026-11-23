import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkStorage } from './server.mjs';

function simulatedStorage({ corrupt = false, interrupted = false } = {}) {
  const entries = new Map();
  const request = async (address, { method = 'GET', body, headers }) => {
    assert.ok(headers.get('Authorization') === 'Bearer fixture');
    const url = new URL(address);
    let path = decodeURIComponent(url.pathname);
    if (method === 'POST') {
      if (path.startsWith('/upload/')) {
        path = path.slice('/upload'.length) + '/' + url.searchParams.get('name');
        entries.set(path, body);
        if (interrupted) throw new Error('Response lost');
      } else {
        path += '/' + url.searchParams.get('documentId');
        entries.set(path, JSON.parse(body));
      }
      return new Response('{}');
    }
    if (method === 'DELETE') {
      entries.delete(path);
      return new Response(null, { status: 204 });
    }
    if (!entries.has(path)) return new Response(null, { status: 404 });
    return url.searchParams.has('alt') ? new Response(corrupt ? '' : entries.get(path)) : Response.json(entries.get(path));
  };
  return { entries, request };
}

test('storage probe reads back and removes both uniquely named artifacts', async () => {
  const { entries, request } = simulatedStorage();
  assert.deepEqual(await checkStorage({ project: 'test', bucket: 'bucket', token: 'fixture', request }), {
    ok: true, firestore: true, storage: true,
  });
  assert.equal(entries.size, 0);
});
for (const flag of ['interrupted','corrupt']) {
  test('storage probe cleans both artifacts on ' + flag, async () => {
    const { entries, request } = simulatedStorage({ [flag]: true });
    await assert.rejects(checkStorage({ project: 'test', bucket: 'bucket', token: 'fixture', request }));
    assert.equal(entries.size, 0);
  });
}
