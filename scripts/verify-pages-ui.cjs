// CI installs playwright-core in a temporary directory and uses the runner's Chrome.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

async function verifyCloud(browser, worker, editAfterLoss = false) {
  const { Readable } = require('node:stream');
  const { intakeSummary } = await import('../lib/intake-record.mjs');
  const { createVisitsHandler } = await import('../cloud/visits.mjs');
  const records = new Map();
  const visits = createVisitsHandler({
    principal: req => req.headers.authorization === 'Bearer browser-fixture' ? 'synthetic-browser' : null,
    store: {
      async transact(owner, id, decide) {
        const { value, result } = decide(records.get(id));
        if (value) records.set(id, value);
        return result;
      },
      async list() {
        return [...records.values()].filter(v => v.record)
          .map(v => ({ expiresAt: v.expiresAt, summary: intakeSummary(v.record) }));
      },
    },
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const submissions = [];
  let loseSubmission = true, loseReview = true;
  let staleReview = true;
  await page.route('https://cloud.invalid/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith('/api/')) {
      const response = await worker.fetch(new Request(request.url()), {});
      await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer()) });
      return;
    }
    const headers = request.headers();
    const method = request.method();
    const invoke = (body, options = {}) => visits(Object.assign(
      Readable.from(body ? [Buffer.from(body)] : []), { method, headers, ...options }), path);
    let response;
    try {
      const body = request.postData();
      if (method === 'POST' && path === '/api/intakes') {
        submissions.push({ key: headers['idempotency-key'], body });
        if (!editAfterLoss) assert.deepEqual(submissions.at(-1), submissions[0]);
      }
      if (path.endsWith('/review') && staleReview) {
        staleReview = false;
        const initial = JSON.parse(body);
        await invoke(JSON.stringify({ ...initial, status: 'held', note: '다른 창의 가상 보류' }));
      }
      response = await invoke(body);
      if ((method === 'POST' && path === '/api/intakes' && loseSubmission) ||
          (path.endsWith('/review') && loseReview)) {
        if (path === '/api/intakes') {
          loseSubmission = false;
          if (editAfterLoss) {
            await route.fulfill({ status: 502, contentType: 'text/html', body: '<p>Gateway error</p>' });
            return;
          }
        } else loseReview = false;
        response = { status: 503, body: { error: '합성 저장 응답 유실' } };
      }
    } catch (error) {
      response = { status: error.status || 500, body: { error: error.message } };
    }
    await route.fulfill({ status: response.status ?? 200, json: response.body });
  });

  const action = name => page.locator('[data-action="' + name + '"]').last().click();
  const choose = selector => page.locator('label').filter({ has: page.locator(selector) }).click();
  await page.goto('https://cloud.invalid/?cloud=1');
  await page.locator('#cloud-token').fill('browser-fixture');
  await page.locator('#cloud-auth button').click();
  await choose('input[name="synthetic"]');
  await choose('input[name="privacy"]');
  await action('next');
  await action('sample-complaint');
  const draftComplaint = await page.locator('#complaint').inputValue();
  await action('staff');
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('.staff-main').waitFor();
  await action('guardian');
  assert.equal(await page.locator('#complaint').inputValue(), draftComplaint);
  await action('next');
  await action('sample-answers');
  await action('next');
  for (const risk of await page.locator('.risk-list input[value="no"]').evaluateAll(inputs => inputs.map(input => input.name)))
    await choose('input[name="' + risk + '"][value="no"]');
  await choose('#final-confirm');
  await action('next');
  await page.getByText(editAfterLoss ? /클라우드 응답을 확인할 수 없습니다/ : '합성 저장 응답 유실').waitFor();
  assert.equal(await page.locator('#final-confirm').isChecked(), true);
  let editedComplaint;
  if (editAfterLoss) {
    await action('back');
    await action('back');
    const complaint = page.locator('#complaint');
    editedComplaint = await complaint.inputValue() + ' 오늘은 물도 조금 마셨어요.';
    await complaint.fill(editedComplaint);
    await action('next');
    await action('next');
    await choose('#final-confirm');
    await action('next');
    await page.getByRole('status').filter({ hasText: /첫 제출이 이미 접수되었습니다/ }).waitFor({ timeout: 3000 });
    assert.equal(await page.locator('#final-confirm').isChecked(), true);
    assert.equal(submissions.length, 2);
    assert.equal(submissions[1].key, submissions[0].key);
    assert.equal(JSON.parse(submissions[1].body).complaint, editedComplaint);
  } else {
    await action('next');
    await page.locator('.receipt').waitFor();
  }
  await action('staff');
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('tbody [data-open]').first().waitFor();
  assert.equal(await page.locator('tbody [data-open]').count(), 1);
  if (editAfterLoss) {
    await action('guardian');
    await action('back');
    await action('back');
    assert.equal(await page.locator('#complaint').inputValue(), editedComplaint);
    await action('next');
    await action('next');
    await action('staff');
    await page.locator('#login-form button[type="submit"]').click();
  }
  await page.locator('tbody [data-open]').click();
  assert.equal(await page.locator('.source-text').first().textContent(), JSON.parse(submissions[0].body).complaint);
  const hpi = page.locator('#review-hpi');
  const edited = await hpi.inputValue() + '\n시연 입력 유지';
  await hpi.fill(edited);
  await action('guardian');
  if (!editAfterLoss) await page.locator('.receipt').waitFor();
  await action('staff');
  await page.locator('#login-form button[type="submit"]').click();
  await page.locator('tbody [data-open]').click();
  assert.equal(await hpi.inputValue(), edited);
  await choose('#source-confirmed');
  if (await page.locator('#risk-confirmed').count()) await choose('#risk-confirmed');
  await action('approve');
  await page.getByText(/문서 버전이 변경되었습니다/).waitFor();
  assert.equal(await page.locator(':focus').getAttribute('data-action'), 'approve');
  assert.equal(await hpi.inputValue(), edited);
  await page.getByRole('button', { name: '최신 기록 다시 열기' }).click();
  await page.getByText('현재 저장본 확인 · 내 수정은 입력란에 유지').waitFor();
  assert.equal(await hpi.inputValue(), edited);
  assert.equal(await page.locator('#source-confirmed').isChecked(), false);
  await choose('#source-confirmed');
  if (await page.locator('#risk-confirmed').count()) await choose('#risk-confirmed');
  await action('approve');
  await page.getByText('합성 저장 응답 유실').waitFor();
  assert.equal(await hpi.inputValue(), edited);
  await action('approve');
  await page.locator('.export-bar .button-row button[data-export="hpi"]:enabled').waitFor();
  assert.equal([...records.values()][0].history.length, 2);
  await page.locator('[data-export="hpi"]').click();
  await page.getByText(/승인본을 복사했습니다|승인본을 직접 선택해 복사해 주세요/).waitFor();
  page.once('dialog', dialog => dialog.accept());
  await action('delete-record');
  await page.getByText('아직 접수된 문진이 없어요.').waitFor();
  await action('guardian');
  assert.equal(await page.locator('.receipt').count(), 0);
  if (editAfterLoss) {
    await action('back');
    await action('back');
    assert.equal(await page.locator('#complaint').inputValue(), editedComplaint);
  }
  assert.deepEqual(errors, []);
  await page.close();
}

async function run() {
  const { default: worker } = await import('../dist/_worker.js');
  const { leoCases, scoreQuestions } = await import('../test/leo-cases.mjs');
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome' });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://demo.invalid/**', async route => {
      const response = await worker.fetch(new Request(route.request().url()), {});
      await route.fulfill({
        status: response.status, headers: Object.fromEntries(response.headers),
        body: Buffer.from(await response.arrayBuffer())
      });
    });
    await page.goto('https://demo.invalid/');
    const action = name => page.locator('[data-action="' + name + '"]').last().click();
    const choose = selector => page.locator('label').filter({ has: page.locator(selector) }).click();
    async function startLeo(visitType = 'first') {
      await choose('input[value="demo-leo"]');
      await page.locator('#visitType').selectOption(visitType);
      await choose('input[name="synthetic"]');
      await choose('input[name="privacy"]');
      await action('next');
    }
    async function submit(risks = {}) {
      const names = await page.locator('.risk-list input[value="no"]').evaluateAll(items => items.map(el => el.name));
      assert.deepEqual(names, ['breathing', 'collapse', 'bleeding', 'toxin', 'urine', 'abdomen', 'heat', 'birth'].map(id => `risk-${id}`));
      await action('next');
      assert.equal(await page.locator(':focus').getAttribute('name'), 'risk-breathing');
      const breathingYes = page.locator('input[name="risk-breathing"][value="yes"]');
      const breathingNo = page.locator('input[name="risk-breathing"][value="no"]');
      await breathingYes.press('Space');
      await page.keyboard.press('ArrowRight');
      assert.equal(await breathingNo.evaluate(el => el === document.activeElement && el.checked), true);
      const details = page.locator('.review-details');
      if (await details.evaluate(el => el.open)) {
        await choose('input[name="risk-breathing"][value="yes"]');
        assert.equal(await details.evaluate(el => el.open), true);
        await choose('input[name="risk-breathing"][value="no"]');
      }
      for (const name of names.slice(1)) await choose(`input[name="${name}"][value="${risks[name.slice(5)] ?? 'no'}"]`);
      await action('next');
      assert.equal(await page.locator(':focus').getAttribute('id'), 'final-confirm');
      await choose('#final-confirm');
      await action('next');
      await page.locator('.receipt').waitFor();
    }
    async function openReview() {
      await action('staff');
      await page.locator('#role').selectOption('vet');
      await page.locator('#login-form [type="submit"]').click();
      await page.locator('[data-open]').first().click();
      assert.equal(await page.locator('#review-panel h2').evaluate(el => el === document.activeElement), true);
    }

    await startLeo();
    await action('next');
    assert.equal(await page.locator(':focus').getAttribute('id'), 'complaint');
    await action('sample-complaint');
    await action('next');
    await action('sample-answers');
    await action('next');
    await submit();
    await openReview();
    await action('close-review');
    assert.equal(await page.locator(':focus').getAttribute('data-open'), await page.locator('[data-open]').first().getAttribute('data-open'));
    await page.keyboard.press('Enter');
    assert.match(await page.locator('#review-hpi').inputValue(), /레오 \/ 강아지/);
    await page.locator('[data-doc="soapS"]').click();
    assert.equal(await page.locator('[data-doc="soapS"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-doc="hpi"]').getAttribute('aria-pressed'), 'false');
    await choose('#source-confirmed');
    if (await page.locator('#risk-confirmed').count()) await choose('#risk-confirmed');
    await action('approve');
    await page.locator('[data-export="hpi"]:enabled').waitFor();
    page.once('dialog', dialog => dialog.accept());
    await action('delete-record');
    await page.locator('.empty-state').waitFor();

    for (const scenario of leoCases) {
      await page.reload();
      await startLeo(scenario.visitType);
      await page.locator('[data-category="digestive"]').click();
      await page.locator('#complaint').fill(scenario.original ?? scenario.complaint);
      await action('next');
      if (scenario.original) {
        assert.equal(await page.locator('.quote-box p').textContent(), scenario.original);
        for (const [id, answer] of Object.entries(scenario.originalAnswers)) await page.locator(`#q-${id}`).fill(answer);
        await page.getByRole('button', { name: '증상 설명 수정' }).click();
        await page.locator('#complaint').fill(scenario.complaint);
        await action('next');
        assert.match(await page.locator('#answer-recovery').textContent(), /관련 답변도 수정/);
        for (const [id, answer] of Object.entries(scenario.originalAnswers)) assert.equal(await page.locator(`#q-${id}`).inputValue(), answer);
      }
      const fields = page.locator('textarea[data-answer]');
      await fields.first().waitFor();
      const questionIds = await fields.evaluateAll(items => items.map(el => el.dataset.answer));
      assert.deepEqual(scoreQuestions(scenario, questionIds), scenario.baseline, scenario.id);
      for (const id of questionIds) {
        await page.locator(`#q-${id}`).fill(scenario.answers?.[id] ?? '모름');
      }
      await action('next');
      if (scenario.original) {
        await page.locator('.review-details summary').click();
        const summary = await page.locator('.review-details').textContent();
        assert.ok(summary.includes(scenario.complaint));
        assert.doesNotMatch(summary, /두 번/);
      }
      await submit(scenario.risks);
      await openReview();
      assert.equal(await page.locator('.source-text').textContent(), scenario.complaint);
      if (scenario.original) {
        const original = await page.locator('.source-pane').textContent();
        assert.doesNotMatch(original, /두 번/);
        for (const answer of Object.values(scenario.answers)) assert.ok(original.includes(answer));
      }
      for (const id of ['review-hpi', 'review-soapS']) {
        const draft = await page.locator(`#${id}`).inputValue();
        assert.ok(draft.includes(scenario.complaint), scenario.id);
        if (scenario.original) {
          assert.doesNotMatch(draft, /두 번/);
          for (const answer of Object.values(scenario.answers)) assert.ok(draft.includes(answer));
        }
      }
      if (scenario.flag) assert.match(await page.locator('#review-panel .risk-banner').textContent(), /원문 키워드 후보/);
      if (scenario.id === 'unknown') {
        assert.match(await page.locator('.missing-box').textContent(), /언제부터 시작됐나요/);
        assert.match(await page.locator('#review-panel .risk-banner').textContent(), /보호자 확인 필요/);
      }
      if (scenario.visitType === 'return') assert.match(await page.locator('#review-hpi').inputValue(), /레오 \/ 강아지 \/ 재진/);
    }
    assert.deepEqual(errors, []);
    await verifyCloud(browser, worker);
    await verifyCloud(browser, worker, true);
  } finally {
    await browser?.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
