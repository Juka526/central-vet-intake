// CI installs playwright-core in a temporary directory and uses the runner's Chrome.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

async function run() {
  const { default: worker } = await import('../dist/_worker.js');
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

    await page.reload();
    await startLeo();
    const complaint = '어제 두 번 토했어요. 오늘 한 번 토했어요. 설사는 오늘 세 번 했어요. 둘 다 어제부터였어요. 사료를 절반만 먹었어요.';
    await page.locator('#complaint').fill(complaint);
    await page.locator('[data-category="digestive"]').click();
    await page.locator('[data-category="respiratory"]').click();
    assert.equal(await page.locator('[data-category="digestive"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-category="respiratory"]').getAttribute('aria-pressed'), 'true');
    await page.locator('[data-category="respiratory"]').click();
    await page.locator('[data-symptom="vomit"]').click();
    await page.locator('[data-symptom="diarrhea"]').click();
    assert.equal(await page.locator('[data-symptom="vomit"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.locator('[data-symptom="diarrhea"]').getAttribute('aria-pressed'), 'true');
    await action('next');
    const yesterday = page.getByLabel('어제 몇 번 토했나요?', { exact:true });
    await yesterday.fill('4회');
    await action('confirm-candidates');
    assert.equal(await page.locator('[data-current]').count(), 0);
    await page.getByText('확인한 답변 수정', { exact:true }).click();
    assert.equal(await yesterday.inputValue(),'4회');
    assert.equal(await page.getByLabel('오늘 몇 번 토했나요?', {exact:true}).inputValue(),'1회');
    assert.equal(await page.getByLabel('오늘 설사가 몇 번 있었나요?', {exact:true}).inputValue(),'3회');
    await yesterday.fill('5회');
    await action('save-edits');
    await action('next');
    await page.locator('.review-details summary').click();
    assert.match(await page.locator('.review-details').textContent(), /5회 \(보호자 정정\)/);
    await submit({toxin:'unsure'});
    await openReview();
    assert.equal(await page.locator('.source-text').textContent(), complaint);
    for (const id of ['review-hpi','review-soapS']) {
      const document = await page.locator('#'+id).inputValue();
      assert.match(document, /어제 몇 번 토했나요\? 5회 \(보호자 정정\)/);
      assert.match(document, /오늘 몇 번 토했나요\? 1회/);
      assert.match(document, /오늘 설사가 몇 번 있었나요\? 3회/);
    }
    assert.match(await page.locator('#review-panel .risk-banner').textContent(), /보호자 확인 필요/);

    await page.reload();
    await startLeo();
    await page.locator('#complaint').fill('어제부터 토했어요.');
    await action('next');
    await action('confirm-candidates');
    await action('next');
    assert.equal(await page.locator(':focus').getAttribute('id'),'q-vomit-count');
    await page.locator('[data-current]').fill('글쎄요');
    await action('save-answer');
    assert.match(await page.locator('.question small').first().textContent(), /관찰한 횟수/);
    await page.locator('[data-current]').fill('아마 두 번');
    await action('save-answer');
    assert.equal(await page.locator('[data-current]').getAttribute('id'),'q-meal');
    await action('unknown-answer');
    assert.equal(await page.locator('[data-current]').count(),0);
    await action('next');
    await submit();
    await openReview();
    assert.match(await page.locator('.missing-box').textContent(), /이번에 몇 번 토했나요/);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
