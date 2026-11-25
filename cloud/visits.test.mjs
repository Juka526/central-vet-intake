import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { verifyCloudVisits } from '../scripts/verify-cloud-visits.mjs';
import { fixture } from '../test/fixture.mjs';
import { makeServer } from './server.mjs';
import { createVisitsHandler } from './visits.mjs';
import { privateAudio } from './audio-store.mjs';
import { firestoreVisits } from './visits-store.mjs';

const project = 'demo-central-vet';
const root = '/v1/projects/' + project + '/databases/(default)/documents';

function fakeFirestore() {
  const documents = new Map();
  const transactions = new Map();
  let failCommit;
  let serial = 0;
  const aborted = () => Response.json({ error: { status: 'ABORTED' } }, { status: 409 });
  async function request(url, options) {
    const path = new URL(url).pathname.slice(root.length);
    const body = JSON.parse(options.body);
    if (path === ':beginTransaction') {
      const transaction = Buffer.from(String(++serial)).toString('base64');
      transactions.set(transaction, {});
      return Response.json({ transaction });
    }
    if (path.endsWith(':runQuery')) {
      const prefix = path.split(':')[0].slice(1) + '/demoIntakeVisits/';
      const cutoff = body.structuredQuery.where.fieldFilter.value.timestampValue;
      return Response.json([...documents.values()].filter(doc =>
        doc.name.includes('/documents/' + prefix) && doc.fields.expiresAt.timestampValue > cutoff)
        .map(({ fields }) => ({ document: { fields: { expiresAt: fields.expiresAt, summary: fields.summary } } })));
    }
    const txn = transactions.get(body.transaction);
    if (path === ':rollback') {
      transactions.delete(body.transaction);
      return Response.json({});
    }
    assert.ok(txn);
    if (path === ':batchGet') {
      [txn.name] = body.documents;
      txn.snapshot = documents.get(txn.name);
      return Response.json([txn.snapshot ? { found: txn.snapshot } : { missing: txn.name }]);
    }
    assert.equal(path, ':commit');
    if (txn.snapshot !== documents.get(txn.name)) return aborted();
    const error = failCommit;
    failCommit = undefined;
    if (error === 'abort') return aborted();
    for (const { update } of body.writes) documents.set(update.name, update);
    transactions.delete(body.transaction);
    if (error === 'lost-response') throw new Error('Synthetic transport failure after commit');
    return Response.json({});
  }
  return { documents, request, failNextCommit: error => { failCommit = error; } };
}

function forwardedToken(subject, exp = Math.floor(Date.now() / 1000) + 3600) {
  const payload = Buffer.from(JSON.stringify({ sub: subject, iss: 'https://accounts.google.com', exp })).toString('base64url');
  return 'bearer e30.' + payload + '.SIGNATURE_REMOVED_BY_GOOGLE';
}

function api(store, now, options) {
  const server = makeServer(undefined, createVisitsHandler({ store, now, ...options }));
  return function call(path, { method = 'GET', subject, role, body, headers = {} } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url: path, headers: {
      'content-type': 'application/json',
      ...(subject && { 'x-serverless-authorization': forwardedToken(subject) }),
      'x-demo-role': role, ...headers,
    } });
    return new Promise(resolve => {
      let status, responseHeaders;
      server.emit('request', req, {
        writeHead(code, headers) { status = code; responseHeaders = headers; },
        end(data) { resolve({ status, headers: responseHeaders, body: Buffer.isBuffer(data) ? data : JSON.parse(data) }); },
      });
    });
  };
}

async function exercise(t, store, fake) {
  const subject = 'synthetic-' + randomUUID();
  const other = 'synthetic-' + randomUUID();
  const id = randomUUID();
  const expiryId = randomUUID();
  const guardianDeleteId = randomUUID();
  let time = Date.now();
  const clock = () => time;
  const call = api(store, clock);
  const visit = '/api/intakes/' + id;
  const asVet = { subject, role: 'vet' };
  const submit = (key, body = fixture()) => call('/api/intakes', {
    method: 'POST', subject, body, headers: { 'idempotency-key': key },
  });
  if (!fake) {
    t.after(async () => {
      const owner = createHash('sha256').update(subject).digest('hex');
      for (const key of [id, expiryId, guardianDeleteId]) {
        const response = await fetch(emulator + root + '/demoIntakeOwners/' + owner + '/demoIntakeVisits/' + key, { method: 'DELETE' });
        assert.ok(response.ok || response.status === 404);
      }
    });
  }

  assert.equal((await call('/api/session')).status, 401);
  assert.equal((await call('/api/session', { headers: { authorization: forwardedToken(subject) } })).status, 401);
  assert.equal((await call('/api/session', { headers: { 'x-serverless-authorization': forwardedToken(subject, 1) } })).status, 401);
  assert.equal((await call('/api/session', { subject })).body.role, 'guardian');
  assert.equal((await call('/api/intakes', { subject })).status, 403);

  fake?.failNextCommit('abort');
  const submissions = await Promise.all([submit(id), submit(id)]);
  assert.deepEqual(submissions.map(result => result.status), [201, 201]);
  assert.deepEqual(submissions[0].body, submissions[1].body);
  const editedInput = fixture({ complaint: '가상 환자가 오늘 토했어요.' });
  const changed = await submit(id, editedInput);
  assert.equal(changed.status, 409);
  assert.equal(changed.body.existingSubmissionId, id);
  assert.equal((await call(visit, { subject, role: 'reception' })).status, 403);
  assert.equal((await call(visit, { subject: other, role: 'vet' })).status, 404);
  assert.equal((await call(visit, { subject: other, method: 'DELETE' })).status, 404);
  assert.deepEqual((await call('/api/intakes', { subject: other, role: 'vet' })).body.items, []);
  const list = (await call('/api/intakes', { subject, role: 'reception' })).body.items;
  assert.equal(list.length, 1);
  assert.equal(list[0].complaint, undefined);

  const post = (action, body, app = call) => app(visit + '/' + action, { ...asVet, method: 'POST', body });
  const pending = (await call(visit, asVet)).body;
  assert.equal((await post('export', { version: 1, kind: 'hpi' })).status, 409);
  const review = { version: 1, status: 'approved', confirmed: true, riskAcknowledged: true,
    hpi: pending.draft.hpi + '\n가상 교정 A', soapS: pending.draft.soapS, note: '' };
  const decisions = await Promise.all([
    post('review', review), post('review', { ...review, hpi: review.hpi + ' B' }),
  ]);
  assert.deepEqual(decisions.map(result => result.status).sort(), [200, 409]);
  const winner = decisions[0].status === 200 ? review : { ...review, hpi: review.hpi + ' B' };
  const replay = await post('review', winner);
  assert.equal(replay.body.version, 2);

  const restarted = api(store, clock);
  assert.deepEqual((await restarted(visit, asVet)).body, replay.body);
  assert.equal((await post('export', { version: 1, kind: 'hpi' }, restarted)).status, 409);
  assert.match((await post('export', { version: 2, kind: 'hpi' }, restarted)).body.text, /가상 교정 A/);
  assert.match((await post('export', { version: 2, kind: 'soapS' }, restarted)).body.text, /수의사 검토·승인/);
  const hold = { ...winner, version: 2, status: 'held', note: '가상 보류 사유' };
  fake?.failNextCommit('lost-response');
  const held = await post('review', hold);
  assert.equal(held.status, fake ? 503 : 200);
  assert.equal((await post('review', hold)).body.version, 3);
  assert.equal((await post('export', { version: 3, kind: 'soapS' })).status, 409);
  const owner = createHash('sha256').update(subject).digest('hex');
  const document = root.slice(4) + '/demoIntakeOwners/' + owner + '/demoIntakeVisits/' + id;
  async function storedPayload() {
    const stored = fake ? fake.documents.get(document)
      : await (await fetch(emulator + '/v1/' + document)).json();
    return JSON.parse(stored.fields.payload.stringValue);
  }
  const history = (await storedPayload()).history;
  assert.deepEqual(history.map(entry => [entry.version, entry.status]), [[2, 'approved'], [3, 'held']]);
  assert.match(history[0].review.hpi, /가상 교정 A/);

  const remove = version => call(visit, { ...asVet, method: 'DELETE', body: { version } });
  assert.equal((await remove(2)).status, 409);
  fake?.failNextCommit('lost-response');
  assert.equal((await remove(3)).status, fake ? 503 : 200);
  assert.equal((await remove(3)).status, 200);
  assert.equal((await submit(id)).status, 409);
  assert.equal((await call(visit, asVet)).status, 404);
  assert.deepEqual((await call('/api/intakes', asVet)).body.items, []);
  assert.deepEqual(Object.keys(await storedPayload()).sort(), ['deletedVersion', 'expiresAt']);
  // A rejected first attempt leaves the key available for the corrected draft.
  assert.equal((await submit(guardianDeleteId, fixture({ finalConfirm: false }))).status, 400);
  assert.equal((await submit(guardianDeleteId, editedInput)).status, 201);
  const ownVisit = '/api/intakes/' + guardianDeleteId;
  assert.equal((await call(ownVisit, { subject, role: 'reception', method: 'DELETE' })).status, 403);
  assert.equal((await call(ownVisit, { subject, method: 'DELETE' })).status, 200);
  assert.equal((await call(ownVisit, { subject, method: 'DELETE' })).status, 200);

  fake?.failNextCommit('lost-response');
  assert.equal((await submit(expiryId)).status, fake ? 503 : 201);
  const retryAfterCommit = await submit(expiryId, editedInput);
  assert.equal(retryAfterCommit.status, 409);
  assert.equal(retryAfterCommit.body.existingSubmissionId, expiryId);
  assert.equal((await submit(expiryId)).status, 201);
  const expiryVisit = '/api/intakes/' + expiryId;
  assert.equal((await call(expiryVisit, asVet)).body.complaint, fixture().complaint.trim());
  assert.equal((await call('/api/intakes', asVet)).body.items.length, 1);
  time += 86_400_000;
  assert.equal((await call('/api/intakes/' + expiryId, asVet)).status, 404);
  assert.deepEqual((await call('/api/intakes', asVet)).body.items, []);
}

test('Cloud Run visit routes, Firestore transactions, isolation, conflicts and ambiguous retries', async t => {
  const fake = fakeFirestore();
  await exercise(t, firestoreVisits({ project, token: async () => null, request: fake.request }), fake);
});

const emulator = process.env.FIRESTORE_EMULATOR_HOST && 'http://' + process.env.FIRESTORE_EMULATOR_HOST;
test('same visit lifecycle against a Firestore emulator', {
  skip: !emulator && process.env.REQUIRE_FIRESTORE_EMULATOR !== '1',
}, async t => {
  assert.ok(emulator, 'FIRESTORE_EMULATOR_HOST is required for emulator verification');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(emulator).hostname));
  await exercise(t, firestoreVisits({ project, token: async () => null, origin: emulator }));
});

test('candidate smoke check exercises visit routes and requires IAM denial', async () => {
  const fake = fakeFirestore();
  const call = api(firestoreVisits({ project, token: async () => null, request: fake.request }), Date.now);
  const invitedToken = 'synthetic-invited';
  const uninvitedToken = 'synthetic-uninvited';
  const request = async (url, { method, headers, body }) => {
    if (headers['X-Serverless-Authorization'] !== 'Bearer ' + invitedToken) {
      return new Response('Denied by synthetic IAM fixture', { status: 403 });
    }
    const { pathname } = new URL(url);
    const response = await call(pathname, {
      method, role: headers['X-Demo-Role'], subject: 'synthetic-invited',
      body: body ? JSON.parse(body) : undefined,
      headers: { 'idempotency-key': headers['Idempotency-Key'] },
    });
    return Response.json(response.body, { status: response.status });
  };
  const options = { origin: 'https://candidate.example', invitedToken, uninvitedToken };
  await verifyCloudVisits({ ...options, request });
  const stored = [...fake.documents.values()];
  assert.equal(stored.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(stored[0].fields.payload.stringValue)).sort(), ['deletedVersion', 'expiresAt']);
  await assert.rejects(verifyCloudVisits({ ...options, request: async () =>
    Response.json({ error: 'Application denied the request' }, { status: 401 }),
  }), /IAM boundary/);
});

test('Cloud audio consent, private playback, exact expiry and idempotent partial deletion', async () => {
  const fake = fakeFirestore();
  const objects = new Map();
  let failDelete = false;
  let afterRead;
  const storageRequest = async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer synthetic-runtime');
    const { pathname, searchParams } = new URL(url);
    const method = options.method ?? 'GET';
    if (method === 'POST') {
      const name = searchParams.get('name');
      assert.equal(searchParams.get('ifGenerationMatch'), '0');
      assert.ok(name.startsWith('intake-audio/'));
      assert.ok(!objects.has(name));
      objects.set(name, options.body);
      return Response.json({});
    }
    if (pathname.endsWith('/o')) {
      return Response.json({ items: [...objects.keys()]
        .filter(name => name.startsWith(searchParams.get('prefix')) && name < searchParams.get('endOffset'))
        .map(name => ({ name })) });
    }
    const key = decodeURIComponent(pathname.split('/').at(-1));
    if (method === 'DELETE') {
      if (failDelete) {
        failDelete = false;
        return new Response(null, { status: 503 });
      }
      return new Response(null, { status: objects.delete(key) ? 204 : 404 });
    }
    assert.equal(searchParams.get('alt'), 'media');
    const bytes = objects.get(key);
    await afterRead?.();
    return bytes ? new Response(bytes) : new Response(null, { status: 404 });
  };
  const store = firestoreVisits({ project, token: async () => null, request: fake.request });
  const audio = privateAudio({ bucket: 'synthetic-private', token: async () => 'synthetic-runtime', request: storageRequest });
  const start = Date.UTC(2026, 0, 1);
  let time = start;
  const cleanupSubject = 'synthetic-cleaner';
  const subject = 'synthetic-owner';
  const otherVet = 'synthetic-other';
  const unapproved = 'synthetic-unapproved';
  const app = () => api(store, () => time, { audio, cleanupSubject,
    audioVetSubjects: new Set([subject, otherVet]) });
  const call = app();
  const vet = { subject, role: 'vet' };
  const guardian = { subject };
  const reception = { subject, role: 'reception' };
  const clean = () => call('/api/intake/audio-cleanup', { method: 'POST', subject: cleanupSubject });
  const bytes = Buffer.alloc(1_000_000);
  bytes.write('OggS');
  const payload = fixture({
    consents: { ...fixture().consents, voice: true, retainAudio: true },
    audio: { type: 'audio/ogg', base64: bytes.toString('base64') },
  });
  const submit = (id, body = payload) => call('/api/intakes', {
    ...guardian, method: 'POST', headers: { 'idempotency-key': id }, body,
  });
  const remove = (path, actor = guardian, body) => app()(path, { ...actor, method: 'DELETE', body });
  const first = randomUUID();
  const visit = '/api/intakes/' + first;
  const playback = visit + '/audio';

  for (const [voice, retainAudio] of [[false, false], [true, false], [false, true]]) {
    const consents = { ...payload.consents, voice, retainAudio };
    assert.equal((await submit(first, { ...payload, consents })).status, 400);
  }
  assert.equal(objects.size, 0);
  await submit(randomUUID(), { ...payload, audio: undefined });
  assert.equal(objects.size, 0);
  const competing = await Promise.all([submit(first), submit(first)]);
  assert.deepEqual(competing.map(result => result.status), [201, 201]);
  const expiry = new Date(start + 3_600_000).toISOString();
  assert.deepEqual(competing.map(result => result.body.audioExpiresAt), [expiry, expiry]);
  assert.equal(objects.size, 1);
  const changed = { ...payload, audio: { ...payload.audio, base64: Buffer.from('OggSdifferent').toString('base64') } };
  assert.equal((await submit(first, changed)).status, 409);
  const unapprovedId = randomUUID();
  const unapprovedVisit = '/api/intakes/' + unapprovedId;
  assert.equal((await call('/api/intakes', {
    subject: unapproved, method: 'POST', headers: { 'idempotency-key': unapprovedId }, body: payload,
  })).status, 201);
  assert.equal((await call(unapprovedVisit + '/audio', { subject: unapproved, role: 'vet' })).status, 403);
  assert.equal((await call(unapprovedVisit, { subject: unapproved, role: 'vet' })).body.audioAvailable, undefined);
  const unconfigured = api(store, () => time, { audio, cleanupSubject });
  assert.equal((await unconfigured(playback, vet)).status, 403);
  assert.equal((await remove(unapprovedVisit, { subject: unapproved })).status, 200);

  const original = await call(playback, vet);
  assert.equal(original.headers['Content-Type'], 'audio/ogg');
  assert.equal(original.headers['Cache-Control'], 'no-store');
  assert.deepEqual(original.body, bytes);
  assert.equal((await call(playback, guardian)).status, 403);
  assert.equal((await call(playback, reception)).status, 403);
  assert.equal((await call(playback, { ...vet, subject: otherVet })).status, 404);
  assert.equal((await call('/api/intake/audio-cleanup', { ...vet, method: 'POST' })).status, 403);
  assert.equal((await remove(playback, reception)).status, 403);
  const record = (await call(visit, vet)).body;
  assert.equal(record.audioAvailable, true);
  assert.equal(record.original, undefined);
  assert.equal(record.audio, undefined);

  time += 3_599_999;
  assert.equal((await call(playback, vet)).status, 200);
  assert.equal((await clean()).status, 200);
  assert.equal(objects.size, 1);
  // The clock crosses the deadline while the bucket GET is in flight.
  afterRead = () => { time++; };
  assert.equal((await call(playback, vet)).status, 404);
  afterRead = undefined;
  assert.equal((await call(playback, vet)).status, 404);
  assert.equal((await call(visit, vet)).body.audioAvailable, undefined);
  failDelete = true;
  assert.equal((await clean()).status, 503);
  assert.equal(objects.size, 1);
  assert.equal((await clean()).status, 200);
  assert.equal(objects.size, 0);

  const second = randomUUID();
  const secondVisit = '/api/intakes/' + second;
  fake.failNextCommit('lost-response');
  assert.equal((await submit(second)).status, 503);
  assert.equal((await submit(second)).status, 201);
  assert.equal(objects.size, 1);
  failDelete = true;
  assert.equal((await remove(secondVisit + '/audio')).status, 503);
  assert.equal((await call(secondVisit + '/audio', vet)).status, 404);
  assert.equal((await call(secondVisit, vet)).status, 200);
  assert.equal((await remove(secondVisit + '/audio')).status, 200);
  assert.equal(objects.size, 0);
  assert.equal((await submit(second)).body.audioExpiresAt, null);

  const third = randomUUID();
  const thirdVisit = '/api/intakes/' + third;
  assert.equal((await submit(third)).status, 201);
  assert.equal((await remove(thirdVisit, vet, { version: 0 })).status, 409);
  failDelete = true;
  assert.equal((await remove(thirdVisit, vet, { version: 1 })).status, 503);
  assert.equal((await call(thirdVisit, vet)).status, 404);
  assert.equal((await call(thirdVisit + '/audio', vet)).status, 404);
  assert.equal((await remove(thirdVisit, vet, { version: 1 })).status, 200);
  assert.equal(objects.size, 0);

  time = start + 86_399_999;
  assert.equal((await call(visit, vet)).status, 200);
  time++;
  assert.equal((await call(visit, vet)).status, 404);
  assert.equal((await call(visit + '/review', { ...vet, method: 'POST', body: {} })).status, 404);
  assert.equal((await call(visit + '/export', { ...vet, method: 'POST', body: {} })).status, 404);
  assert.ok(!(await call('/api/intakes', reception)).body.items.some(item => item.id === first));
});
