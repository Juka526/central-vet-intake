// Run only in the manually dispatched production release job.
import { appendFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token } = process.env;
assert.match(account || '', /^[a-f\d]{32}$/);
assert.ok(token, 'Cloudflare Pages deployment token is required');
const projectUrl = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/pages/projects/central-vet-intake';
async function api(path = '', method = 'GET', body) {
  const response = await fetch(projectUrl + path, {
    method, body, redirect:'error', headers: { Authorization: 'Bearer ' + token },
    signal: AbortSignal.timeout(60000)
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw Error('Cloudflare ' + method + ' ' + path + ': ' + JSON.stringify(result.errors));
  return result.result;
}
async function output(key, value) {
  assert.match(value, /^[a-f\d-]{36}$/);
  await appendFile(process.env.GITHUB_OUTPUT, key + '=' + value + '\n');
}
const [operation, id, old] = process.argv.slice(2);
if (operation === 'snapshot') {
  const project = await api();
  assert.equal(project.production_branch, 'main');
  await output('previous', project.canonical_deployment.id);
} else if (operation === 'deploy') {
  // This repository's Pages bundle already embeds its static assets.
  const data = new FormData();
  data.set('branch', 'main');
  data.set('manifest', '{}');
  data.set('commit_hash', process.env.RELEASE_SHA);
  data.set('_worker.js', new Blob([await readFile('dist/_worker.js')], {type:'application/javascript+module'}), '_worker.js');
  const result = await api('/deployments', 'POST', data);
  await output('deployment', result.id);
} else if (operation === 'verify') {
  assert.match(id, /^[a-f\d-]{36}$/);
  for (let attempt = 0; ; attempt++) {
    const current = await api('/deployments/' + id);
    if (current.latest_stage?.status === 'failure') throw Error('Pages deployment failed');
    if (current.latest_stage?.name === 'deploy' && current.latest_stage.status === 'success' &&
        (await api()).canonical_deployment.id === id) break;
    if (attempt >= 60) throw Error('Timed out waiting for Pages production deployment');
    await sleep(3000);
  }
  const root = 'https://central-vet-intake.pages.dev';
  for (const [path, expected] of [['/', 'data-static-demo'], ['/favicon.svg', '<svg'], ['/lib/engine.mjs', 'demo-leo']]) {
    const res = await fetch(root + path, {cache:'no-store', signal:AbortSignal.timeout(15000)});
    assert.ok(res.ok && (await res.text()).includes(expected), 'Failed production check ' + path);
  }
} else if (operation === 'rollback') {
  assert.match(id, /^[a-f\d-]{36}$/);
  assert.match(old, /^[a-f\d-]{36}$/);
  if ((await api()).canonical_deployment.id === id) await api('/deployments/' + old + '/rollback', 'POST');
} else {
  throw Error('Expected snapshot, deploy, verify or rollback');
}
