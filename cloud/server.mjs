import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

async function metadataToken() {
  const url = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
  const result = await fetch(url, {
    headers: { 'Metadata-Flavor': 'Google' }, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!result.ok) throw new Error('Runtime identity unavailable');
  const { access_token: token } = await result.json();
  if (!token) throw new Error('Missing runtime identity');
  return token;
}

// Each probe owns two unpredictable names and can safely reconcile an ambiguous write.
export async function checkStorage({ project, bucket, token, firestoreOrigin = 'https://firestore.googleapis.com',
  storageOrigin = 'https://storage.googleapis.com', request = fetch }) {
  if (!project || !bucket) throw new Error('Missing storage configuration');
  const id = randomUUID();
  const collection = firestoreOrigin + '/v1/projects/' + encodeURIComponent(project) +
    '/databases/(default)/documents/intakeHealthChecks';
  const document = collection + '/' + id;
  const bucketPath = '/b/' + encodeURIComponent(bucket) + '/o';
  const objectName = encodeURIComponent('health/' + id);
  const object = storageOrigin + '/storage/v1' + bucketPath + '/' + objectName;
  const upload = storageOrigin + '/upload/storage/v1' + bucketPath + '?uploadType=media&ifGenerationMatch=0&name=' + objectName;
  async function call(url, options = {}, expected = [200]) {
    const headers = new Headers(options.headers);
    if (token) headers.set('Authorization', 'Bearer ' + token);
    const response = await request(url, { ...options, headers, redirect: 'error', signal: AbortSignal.timeout(6000) });
    if (!expected.includes(response.status)) throw new Error('Storage request failed: ' + response.status);
    return response;
  }
  try {
    const fields = { marker: { stringValue: id }, expiresAt: { timestampValue: new Date(Date.now() + 3_600_000).toISOString() } };
    await call(collection + '?documentId=' + id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fields }) });
    await call(upload, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: id }, [200,201]);
    const storedDoc = await (await call(document)).json();
    const storedObject = await (await call(object + '?alt=media')).text();
    if (storedDoc.fields?.marker?.stringValue !== id || storedObject !== id) throw new Error('Read-back mismatch');
  } finally {
    const deleted = await Promise.allSettled([document, object].map(url =>
      call(url, { method: 'DELETE' }, [200,204,404])));
    if (deleted.some(status => status.status === 'rejected')) throw new Error('Probe cleanup failed');
  }
  await Promise.all([document, object].map(url => call(url, {}, [404])));
  return { ok: true, firestore: true, storage: true };
}

export function makeServer(probe) {
  return createServer(async (req, res) => {
    let status = 404;
    let body = { error: 'Resource not found' };
    if (req.url === '/api/intake/storage-check') {
      if (req.method !== 'POST') {
        status = 405;
        body = { error: 'POST required' };
        res.setHeader('Allow', 'POST');
      } else {
        try { body = await probe(); status = 200; }
        catch { body = { ok: false, error: 'Storage check failed' }; status = 503; }
      }
    }
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  // Cloud Run IAM enforces roles/run.invoker before a request reaches this container.
  makeServer(async () => checkStorage({ project: process.env.GCP_PROJECT_ID, bucket: process.env.INTAKE_BUCKET,
    token: await metadataToken() })).listen(Number(process.env.PORT || 8080), '0.0.0.0');
}
