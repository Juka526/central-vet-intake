// Run when both emulator services are listening. Dedicated synthetic bucket per run.
import { randomUUID } from 'node:crypto';
import { checkStorage } from './server.mjs';

function loopback(variable) {
  const target = new URL('http://' + process.env[variable]);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) throw new Error(variable + ' must be loopback');
  return target.origin;
}
const firestoreOrigin = loopback('FIRESTORE_EMULATOR_HOST');
const storageOrigin = loopback('STORAGE_EMULATOR_HOST');
const project = 'demo-central-vet';
const bucket = 'cv-test-' + randomUUID();
const created = await fetch(storageOrigin + '/storage/v1/b?project=' + project, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: bucket }),
});
if (!created.ok) throw new Error('Could not create emulator bucket: ' + created.status);
try {
  console.log(await checkStorage({ project, bucket, firestoreOrigin, storageOrigin }));
} finally {
  const deleted = await fetch(storageOrigin + '/storage/v1/b/' + bucket, { method: 'DELETE' });
  if (!deleted.ok) throw new Error('Could not remove emulator bucket: ' + deleted.status);
}
