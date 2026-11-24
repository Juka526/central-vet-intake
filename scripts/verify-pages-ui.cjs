// CI installs playwright-core in a temporary directory and uses the runner's Chrome.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

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
  } finally {
    await browser?.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
