import { intakeSummary } from '../lib/intake-record.mjs';

const collection = 'demoIntakeVisits';

export function firestoreVisits({ project, token, origin = 'https://firestore.googleapis.com', request = fetch }) {
  const root = `projects/${project}/databases/(default)/documents`;
  const endpoint = `${origin}/v1/${root}`;
  const parent = owner => `demoIntakeOwners/${owner}`;
  const decode = doc => JSON.parse(doc.fields.payload.stringValue);

  async function call(path, body) {
    const accessToken = await token();
    const response = await request(endpoint + path, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
      headers: { 'Content-Type': 'application/json', ...(accessToken && { Authorization: 'Bearer ' + accessToken }) },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw Object.assign(new Error('Firestore request failed'), {
        aborted: result?.error?.status === 'ABORTED',
      });
    }
    return response.json();
  }

  async function transact(owner, id, decide) {
    const name = `${root}/${parent(owner)}/${collection}/${id}`;
    let retryTransaction;
    for (let attempt = 0; attempt < 5; attempt++) {
      let transaction;
      try {
        ({ transaction } = await call(':beginTransaction', { options: { readWrite: { retryTransaction } } }));
        const [read] = await call(':batchGet', { documents: [name], transaction });
        const { value, result } = decide(read.found ? decode(read.found) : null);
        if (value === undefined) {
          await call(':rollback', { transaction });
          return result;
        }
        const writes = [{ update: { name, fields: {
          expiresAt: { timestampValue: value.expiresAt },
          payload: { stringValue: JSON.stringify(value) },
          ...(value.record && { summary: { stringValue: JSON.stringify(intakeSummary(value.record)) } }),
        } } }];
        await call(':commit', { transaction, writes });
        return result;
      } catch (error) {
        if (transaction) await call(':rollback', { transaction }).catch(() => {});
        if (!error.aborted || attempt === 4) throw error;
        retryTransaction = transaction ?? retryTransaction;
        await new Promise(resolve => setTimeout(resolve, 25 * 2 ** attempt + Math.random() * 25));
      }
    }
  }

  async function list(owner, now) {
    const rows = await call(`/${parent(owner)}:runQuery`, { structuredQuery: {
      select: { fields: [{ fieldPath: 'summary' }, { fieldPath: 'expiresAt' }] },
      from: [{ collectionId: collection }],
      where: { fieldFilter: { field: { fieldPath: 'expiresAt' }, op: 'GREATER_THAN',
        value: { timestampValue: new Date(now).toISOString() } } },
      orderBy: [{ field: { fieldPath: 'expiresAt' }, direction: 'DESCENDING' }],
    } });
    return rows.flatMap(row => {
      const fields = row.document?.fields;
      return fields?.summary ? [{ summary: JSON.parse(fields.summary.stringValue),
        expiresAt: fields.expiresAt.timestampValue }] : [];
    });
  }

  return { transact, list };
}
