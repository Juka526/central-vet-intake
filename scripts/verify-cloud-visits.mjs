import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { fixture } from '../test/fixture.mjs';

export async function verifyCloudVisits({ origin, invitedToken, uninvitedToken, request = fetch }) {
  const id = randomUUID();
  const path = '/api/intakes/' + id;
  async function call(route, { token = invitedToken, role = 'vet', method = 'GET', body, key } = {}) {
    const response = await request(origin + route, {
      method, redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: {
        ...(token && { 'X-Serverless-Authorization': 'Bearer ' + token }),
        'X-Demo-Role': role,
        ...(body && { 'Content-Type': 'application/json' }),
        ...(key && { 'Idempotency-Key': key }),
      },
      body: body && JSON.stringify(body),
    });
    return response;
  }
  async function expect(route, status, options) {
    const response = await call(route, options);
    assert.equal(response.status, status, (options?.method ?? 'GET') + ' ' + route);
    return response.json();
  }
  for (const token of [null, uninvitedToken]) {
    const denied = await call('/api/session', { token });
    assert.ok([401, 403].includes(denied.status), 'Cloud Run must reject callers without invitation');
    // The application returns JSON errors. IAM must reject the request at the edge.
    assert.ok(!denied.headers.get('content-type')?.includes('application/json'), 'Expected denial at the IAM boundary');
    await denied.body?.cancel();
  }
  await expect('/api/session', 200, { role: 'guardian' });

  const submit = { method: 'POST', role: 'guardian', body: fixture(), key: id };
  try {
    const receipt = await expect('/api/intakes', 201, submit);
    assert.deepEqual(await expect('/api/intakes', 201, submit), receipt);
    const { items } = await expect('/api/intakes', 200, { role: 'reception' });
    assert.ok(items.some(item => item.id === id && item.complaint === undefined));
    await expect(path, 403, { role: 'reception' });

    const pending = await expect(path, 200);
    const review = { version: pending.version, status: 'approved', confirmed: true, riskAcknowledged: true,
      hpi: pending.draft.hpi + '\n가상 검토 완료', soapS: pending.draft.soapS, note: '' };
    const approved = await expect(path + '/review', 200, { method: 'POST', body: review });
    assert.equal(approved.version, pending.version + 1);
    assert.deepEqual(await expect(path + '/review', 200, { method: 'POST', body: review }), approved);
    await expect(path + '/review', 409, { method: 'POST', body: { ...review, hpi: review.hpi + ' B' } });

    await expect('/api/session', 200);
    assert.deepEqual(await expect(path, 200), approved);
    for (const kind of ['hpi', 'soapS']) {
      const { text } = await expect(path + '/export', 200, { method: 'POST', body: { version: approved.version, kind } });
      assert.ok(text.includes(approved.review[kind]));
    }
    await expect(path, 409, { method: 'DELETE', body: { version: pending.version } });
    await expect(path, 200, { method: 'DELETE', body: { version: approved.version } });
    await expect(path, 404);
  } finally {
    const cleanup = await call(path, { method: 'DELETE', role: 'guardian' });
    await cleanup.body?.cancel();
    assert.ok([200, 404].includes(cleanup.status), 'Synthetic visit cleanup failed');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { CLOUD_VISITS_ORIGIN, CLOUD_VISITS_INVITED_TOKEN, CLOUD_VISITS_UNINVITED_TOKEN } = process.env;
    const target = new URL(CLOUD_VISITS_ORIGIN);
    assert.ok(target.protocol === 'https:' && target.hostname.endsWith('.run.app') &&
      target.href === target.origin + '/', 'Expected an HTTPS Cloud Run origin');
    assert.ok(CLOUD_VISITS_INVITED_TOKEN && CLOUD_VISITS_UNINVITED_TOKEN &&
      CLOUD_VISITS_INVITED_TOKEN !== CLOUD_VISITS_UNINVITED_TOKEN, 'Expected distinct IAM test identities');
    await verifyCloudVisits({ origin: target.origin, invitedToken: CLOUD_VISITS_INVITED_TOKEN,
      uninvitedToken: CLOUD_VISITS_UNINVITED_TOKEN });
    console.log('Cloud Run IAM and synthetic visit lifecycle passed');
  } catch {
    // Assertion details and HTTP responses can contain account or visit data.
    console.error('Cloud Run IAM or synthetic visit lifecycle verification failed');
    process.exitCode = 1;
  }
}
