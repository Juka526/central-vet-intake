import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { verifyCloudVisits } from '../scripts/verify-cloud-visits.mjs';
import { fixture } from '../test/fixture.mjs';
import { makeServer } from './server.mjs';
import { createVisitsHandler } from './visits.mjs';
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

function api(store, now) {
  const server = makeServer(undefined, createVisitsHandler({ store, now }));
  return function call(path, { method = 'GET', subject, role, body, headers = {} } = {}) {
    const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
    Object.assign(req, { method, url: path, headers: {
      'content-type': 'application/json',
      ...(subject && { 'x-serverless-authorization': forwardedToken(subject) }),
      'x-demo-role': role, ...headers,
    } });
    return new Promise(resolve => {
      let status;
      server.emit('request', req, {
        writeHead(code) { status = code; },
        end(data) { resolve({ status, body: JSON.parse(data) }); },
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
  assert.equal((await submit(id, fixture({ complaint: '가상 환자가 오늘 토했어요.' }))).status, 409);
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
  assert.equal((await submit(guardianDeleteId)).status, 201);
  const ownVisit = '/api/intakes/' + guardianDeleteId;
  assert.equal((await call(ownVisit, { subject, role: 'reception', method: 'DELETE' })).status, 403);
  assert.equal((await call(ownVisit, { subject, method: 'DELETE' })).status, 200);
  assert.equal((await call(ownVisit, { subject, method: 'DELETE' })).status, 200);

  fake?.failNextCommit('lost-response');
  assert.equal((await submit(expiryId)).status, fake ? 503 : 201);
  assert.equal((await submit(expiryId)).status, 201);
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
