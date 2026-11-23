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
    await choose('input[value="demo-leo"]');
    await choose('input[name="synthetic"]');
    await choose('input[name="privacy"]');
    await action('next');
    await action('sample-complaint');
    await action('next');
    await action('sample-answers');
    await action('next');
    for (const name of await page.locator('.risk-list input[value="no"]').evaluateAll(items => items.map(el => el.name))) {
      await choose('input[name="' + name + '"][value="no"]');
    }
    await choose('#final-confirm');
    await action('next');
    await page.locator('.receipt').waitFor();
    await action('staff');
    await page.locator('#role').selectOption('vet');
    await page.locator('#login-form [type="submit"]').click();
    await page.locator('[data-open]').first().click();
    assert.match(await page.locator('#review-hpi').inputValue(), /레오 \/ 강아지/);
    await choose('#source-confirmed');
    if (await page.locator('#risk-confirmed').count()) await choose('#risk-confirmed');
    await action('approve');
    await page.locator('[data-export="hpi"]:enabled').waitFor();
    page.once('dialog', dialog => dialog.accept());
    await action('delete-record');
    await page.locator('.empty-state').waitFor();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
