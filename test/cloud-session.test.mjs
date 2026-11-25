import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as engine from '../lib/engine.mjs';

test('idle reset discards a delayed detail response from the previous cloud account', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const handlers = {};
  const nodes = new Map([['#toast', {}]]);
  const app = {
    addEventListener(type, handler) { handlers[type] = handler; },
    replaceChildren() { this.innerHTML = ''; },
  };
  const document = {
    documentElement: { hasAttribute: () => true },
    querySelector: selector => selector === '#app' ? app : nodes.get(selector) ?? null,
    body: { append(dialog) { nodes.set('#cloud-auth', dialog); dialog.isConnected = true; } },
    createElement() {
      const fields = { form: {}, button: {}, input: {}, '#cloud-error': {} };
      return {
        setAttribute() {}, addEventListener() {}, showModal() {},
        close() { this.remove(); },
        remove() { nodes.delete('#cloud-auth'); this.isConnected = false; },
        querySelector: selector => fields[selector],
      };
    },
  };
  let idle;
  let releaseDetail, detailSignal;
  const detail = new Promise(resolve => { releaseDetail = resolve; });
  const record = { id: 'synthetic-account-a-record' };
  const appState = await runInNewContext(
    '(async () => {' + source.replace(/^import .*\n/, '') +
    '\nreturn { selected: () => selected, complaint: () => form.complaint }; })()',
    {
      ...engine, document, location: { search: '?cloud=1' }, URLSearchParams, AbortController,
      FormData: class { get() { return 'vet'; } },
      window: { addEventListener() {}, scrollTo() {} },
      setTimeout(fn, ms) { if (ms === 900000) idle = fn; },
      clearTimeout() {},
      async fetch(path, options) {
        const account = options.headers.Authorization;
        if (path === '/api/intakes/' + record.id) detailSignal = options.signal;
        const data = path === '/api/session'
          ? { scope: account, role: options.headers['X-Demo-Role'] }
          : path === '/api/intakes' ? { items: [] } : await detail;
        return { ok: true, json: async () => data };
      },
    },
  );
  async function connect(account) {
    const dialog = nodes.get('#cloud-auth');
    dialog.querySelector('input').value = account;
    await dialog.querySelector('form').onsubmit({ preventDefault() {} });
  }
  function click(dataset) {
    const button = { dataset, isConnected: true };
    return handlers.click({ target: { closest: () => button } });
  }
  async function openInbox() {
    await click({ action: 'staff' });
    await handlers.submit({ target: { id: 'login-form', querySelector: () => ({}) }, preventDefault() {} });
  }

  await connect('synthetic-a');
  handlers.input({ target: { name: 'complaint', value: '가상 문진 입력', dataset: {} } });
  await openInbox();
  await click({ action: 'guardian' });
  assert.equal(appState.complaint(), '가상 문진 입력');
  await openInbox();
  const opening = click({ open: record.id }).catch(error => error);
  await idle();
  await connect('synthetic-b');
  assert.equal(appState.complaint(), '');
  releaseDetail(record);
  const result = await opening;
  assert.equal(appState.selected(), null, 'the delayed detail must not enter the next account state');
  assert.equal(result, undefined);
  assert.equal(detailSignal?.aborted, true);
  await openInbox();
  assert.match(app.innerHTML, /아직 접수된 문진이 없어요/);
  assert.doesNotMatch(app.innerHTML, /review-panel/);
});
