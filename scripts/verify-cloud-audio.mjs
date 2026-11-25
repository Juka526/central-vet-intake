import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fixture } from '../test/fixture.mjs';

export async function verifyCloudAudio({ origin, project, bucket, vetToken, invitedToken, storageToken, request = fetch }) {
  const bytes = Buffer.from('OggS synthetic retention probe');
  const payload = fixture({
    consents: { ...fixture().consents, voice: true, retainAudio: true },
    audio: { type: 'audio/ogg', base64: bytes.toString('base64') },
  });
  const documents = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(project) +
    '/databases/(default)/documents/demoIntakeOwners/';
  const objects = 'https://storage.googleapis.com/storage/v1/b/' + encodeURIComponent(bucket) + '/o/';
  const cleanup = [];

  function send(url, headers, method = 'GET', body) {
    return request(url, { method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { ...headers, ...(body && { 'Content-Type': 'application/json' }) },
      body: body && JSON.stringify(body) });
  }

  function actor(token) {
    return (path, { role = 'vet', method, body, id } = {}) => send(origin + path, {
      'X-Serverless-Authorization': 'Bearer ' + token, 'X-Demo-Role': role,
      ...(id && { 'Idempotency-Key': id }),
    }, method, body);
  }

  async function status(response, expected, step) {
    assert.ok(expected.includes(response.status), step + ' returned ' + response.status);
    await response.body?.cancel();
  }

  const vet = actor(vetToken);
  const invited = actor(invitedToken);
  const storageAuth = { Authorization: 'Bearer ' + storageToken };

  async function submit(call, body, expected) {
    const id = randomUUID();
    const path = '/api/intakes/' + id;
    cleanup.push(() => call(path, { role: 'guardian', method: 'DELETE' }));
    await status(await call('/api/intakes', { role: 'guardian', method: 'POST', id, body }), [expected], 'Submission');
    return { id, path };
  }

  async function storedObject(call, id) {
    const session = await call('/api/session');
    assert.equal(session.status, 200, 'Invited session');
    const { scope } = await session.json();
    assert.match(scope, /^[0-9a-f]{64}$/);
    const doc = await send(documents + scope + '/demoIntakeVisits/' + id, storageAuth);
    assert.equal(doc.status, 200, 'Firestore synthetic visit');
    const { original } = JSON.parse((await doc.json()).fields.payload.stringValue);
    assert.match(original.key, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\/[a-f0-9-]{36}$/);
    return objects + encodeURIComponent('intake-audio/' + original.key) + '?alt=media';
  }

  try {
    for (const consent of ['voice', 'retainAudio']) {
      const { path } = await submit(vet, { ...payload, consents: { ...payload.consents, [consent]: false } }, 400);
      await status(await vet(path), [404], 'Rejected submission lookup');
    }
    const denied = await submit(invited, payload, 201);
    await status(await invited(denied.path + '/audio'), [403], 'Invited account without playback permission');
    await status(await vet(denied.path + '/audio'), [404], 'Different account playback');

    for (const audioOnly of [true, false]) {
      const { id, path } = await submit(vet, payload, 201);
      const playback = path + '/audio';
      const object = await storedObject(vet, id);
      const stored = await send(object, storageAuth);
      assert.equal(stored.status, 200, 'Authenticated object lookup before deletion');
      assert.deepEqual(Buffer.from(await stored.arrayBuffer()), bytes);
      await status(await send(object, {}), [401, 403], 'Anonymous object lookup');
      for (const role of ['guardian', 'reception']) {
        await status(await vet(playback, { role }), [403], role + ' playback');
      }
      const streamed = await vet(playback);
      assert.equal(streamed.status, 200, 'Authorized playback');
      assert.equal(streamed.headers.get('cache-control'), 'no-store');
      assert.equal(streamed.headers.get('content-type'), payload.audio.type);
      assert.deepEqual(Buffer.from(await streamed.arrayBuffer()), bytes);

      const remove = () => vet(audioOnly ? playback : path, { role: 'guardian', method: 'DELETE' });
      await status(await remove(), [200], 'User deletion');
      await status(await vet(playback), [404], 'Playback after deletion');
      await status(await vet(path), [audioOnly ? 200 : 404], 'Visit lookup after deletion');
      await status(await send(object, storageAuth), [404], 'Authenticated object lookup after deletion');
      await status(await remove(), [200], 'Repeated user deletion');
    }
  } finally {
    const results = await Promise.allSettled(cleanup.map(async remove =>
      status(await remove(), [200, 404], 'Synthetic visit cleanup')));
    assert.ok(results.every(result => result.status === 'fulfilled'), 'Synthetic visit cleanup failed');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { CLOUD_VISITS_ORIGIN, CLOUD_AUDIO_PROJECT, CLOUD_AUDIO_BUCKET, CLOUD_AUDIO_VET_TOKEN,
      CLOUD_VISITS_INVITED_TOKEN, CLOUD_AUDIO_STORAGE_TOKEN } = process.env;
    const target = new URL(CLOUD_VISITS_ORIGIN);
    assert.ok(target.protocol === 'https:' && target.hostname.endsWith('.run.app') &&
      target.href === target.origin + '/', 'Expected an HTTPS Cloud Run origin');
    assert.ok(CLOUD_AUDIO_PROJECT && CLOUD_AUDIO_BUCKET && CLOUD_AUDIO_STORAGE_TOKEN &&
      CLOUD_AUDIO_VET_TOKEN && CLOUD_VISITS_INVITED_TOKEN && CLOUD_AUDIO_VET_TOKEN !== CLOUD_VISITS_INVITED_TOKEN);
    await verifyCloudAudio({ origin: target.origin, project: CLOUD_AUDIO_PROJECT, bucket: CLOUD_AUDIO_BUCKET,
      vetToken: CLOUD_AUDIO_VET_TOKEN, invitedToken: CLOUD_VISITS_INVITED_TOKEN, storageToken: CLOUD_AUDIO_STORAGE_TOKEN });
    console.log('Candidate consent, private playback and user deletion checks passed');
  } catch {
    console.error('Candidate audio verification failed');
    process.exitCode = 1;
  }
}
