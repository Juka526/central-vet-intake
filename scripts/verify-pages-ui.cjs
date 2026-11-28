// CI installs playwright-core in a temporary directory and uses the runner's Chrome.
const { chromium } = require('playwright-core');
const assert = require('node:assert/strict');

async function verifyCloud(browser, worker, editAfterLoss = false) {
  const { Readable } = require('node:stream');
  const { intakeSummary } = await import('../lib/intake-record.mjs');
  const { createVisitsHandler } = await import('../cloud/visits.mjs');
  const records = new Map();
  const recordings = new Map();
  let failRemoval = !editAfterLoss;
  const visits = createVisitsHandler({
    principal: req => req.headers.authorization === 'Bearer browser-fixture' ? 'synthetic-browser' : null,
    audioVetSubjects: new Set(['synthetic-browser']),
    audio: {
      async put(key, type, bytes) { recordings.set(key, bytes); },
      async get(key) { return recordings.get(key); },
      async remove(key) {
        if (failRemoval) {
          failRemoval = false;
          throw new Error('Synthetic object deletion failure');
        }
        recordings.delete(key);
      },
    },
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
  if (!editAfterLoss) {
    await page.context().grantPermissions(['microphone'], { origin: 'https://cloud.invalid' });
    await page.addInitScript(() => {
      window.MediaRecorder = class extends MediaRecorder {
        start() {
          document.documentElement.removeAttribute('data-recorded-chunk');
          this.addEventListener('dataavailable', event => {
            if (event.data.size) document.documentElement.setAttribute('data-recorded-chunk', '');
          });
          super.start(100);
        }
      };
      window.SpeechRecognition = class extends EventTarget {
        processLocally = false;
        static async available() { return 'available'; }
        start() {}
        stop() {}
      };
    });
  }
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
    if (response.bytes) {
      await route.fulfill({ status: 200, contentType: response.type, body: response.bytes });
    } else {
      await route.fulfill({ status: response.status ?? 200, json: response.body });
    }
  });

  const action = name => page.locator('[data-action="' + name + '"]').last().click();
  const choose = selector => page.locator('label').filter({ has: page.locator(selector) }).click();
  await page.goto('https://cloud.invalid/?cloud=1');
  await page.locator('#cloud-token').fill('browser-fixture');
  await page.locator('#cloud-auth button').click();
  await choose('input[name="synthetic"]');
  await choose('input[name="privacy"]');
  if (!editAfterLoss) {
    await choose('input[name="voice"]');
    await choose('input[name="retainAudio"]');
  }
  await action('next');
  await action('sample-complaint');
  const draftComplaint = await page.locator('#complaint').inputValue();
  if (!editAfterLoss) {
    async function record() {
      await action('voice');
      await page.getByRole('button', { name: '음성 입력 마치기' }).waitFor();
      await page.locator('html[data-recorded-chunk]').waitFor({ state: 'attached' });
      await action('voice');
      await page.getByRole('button', { name: '녹음만 버리기' }).waitFor();
    }
    await record();
    await action('discard-audio');
    assert.equal(await page.locator('#complaint:focus').inputValue(), draftComplaint);
    await record();
  }
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
  if (!editAfterLoss) {
    await action('play-audio');
    const player = page.getByLabel('시험 음성 원본');
    await player.waitFor({ state: 'attached' });
    assert.equal(await player.evaluate(audio => audio.controls), true);
  }
  await action('guardian');
  if (!editAfterLoss) {
    page.once('dialog', dialog => dialog.accept());
    await action('delete-own-audio');
    await page.getByText(/자료 접근을 차단했습니다/).waitFor();
    assert.equal(recordings.size, 1);
    await page.getByRole('button', { name: '음성 삭제 다시 시도' }).click();
    await page.getByText('음성 원본을 삭제했습니다.').waitFor();
    assert.equal(recordings.size, 0);
  }
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
  await page.locator('#review-panel .status.held').waitFor();
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
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
      args: ['--use-fake-device-for-media-stream'] });
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
    const complaint = '어제는 두 번, 오늘은 한 번 구토했고 오늘 설사는 세 번 했어요. 둘 다 어제부터였어요. 사료를 절반만 먹었어요.';
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
    assert.equal(await yesterday.inputValue(), '2회');
    await yesterday.fill('두세 번');
    await action('confirm-candidates');
    assert.match(await page.locator('.question:has([data-current]) small').textContent(), /관찰한 횟수/);
    await yesterday.fill('4회');
    await action('save-answer');
    assert.equal(await page.locator('[data-current]').count(), 0);
    await page.getByText('확인한 답변 수정', { exact:true }).click();
    assert.equal(await yesterday.inputValue(),'4회');
    assert.equal(await page.getByLabel('오늘 몇 번 토했나요?', {exact:true}).inputValue(),'1회');
    assert.equal(await page.getByLabel('오늘 설사가 몇 번 있었나요?', {exact:true}).inputValue(),'3회');
    await yesterday.fill('두세 번');
    await action('save-edits');
    await yesterday.fill('5회');
    await action('save-answer');
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
    await page.locator('#complaint').fill('어제 한 번 토했어요. 오늘 또 한 번. 밥은 평소와 같아요.');
    await action('next');
    for (const day of ['어제','오늘']) {
      assert.equal(await page.getByLabel(`${day} 몇 번 토했나요?`, {exact:true}).inputValue(), '1회');
    }
    assert.equal(await page.locator('[data-candidate="meal"]').inputValue(), '밥은 평소와 같아요');
    await action('confirm-candidates');
    assert.equal(await page.locator('[data-current]').getAttribute('id'), 'q-vomit-onset');
    await page.locator('[data-current]').fill('어제');
    await action('save-answer');
    assert.equal(await page.locator('[data-current]').count(), 0);
    await action('next');
    await submit();
    await openReview();
    const repeatedVomitHpi = await page.locator('#review-hpi').inputValue();
    assert.match(repeatedVomitHpi, /구토 관찰 시점 · 오늘 오늘/);
    assert.match(repeatedVomitHpi, /오늘 몇 번 토했나요\? 1회/);
    assert.match(repeatedVomitHpi, /밥은 평소와 비교해 얼마나 먹었나요\? 밥은 평소와 같아요/);

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
    await page.locator('#q-meal').fill('평소랑 조금 달라요');
    await action('save-answer');
    assert.match(await page.locator('.question:has(#q-meal) small').textContent(), /얼마나 먹었는지/);
    await page.locator('#q-meal').fill('평소랑 조금 달라요');
    await action('save-answer');
    assert.equal(await page.locator('[data-current]').count(),0);
    await action('next');
    await submit();
    await openReview();
    assert.match(await page.locator('.missing-box').textContent(), /이번에 몇 번 토했나요/);
    assert.match(await page.locator('#review-hpi').inputValue(), /얼마나 먹었나요\? 미확인 \(모르겠어요\)/);
    await page.reload();
    await startLeo();
    await page.locator('#complaint').fill('어제 저녁부터 두 번 토했어요. 사료를 절반만 먹었어요. 물은 평소와 같아요.');
    await action('next');
    await page.locator('[data-candidate="water"]').fill('');
    await action('confirm-candidates');
    await action('next');
    await page.locator('.review-details summary').click();
    assert.match(await page.locator('.review-details').textContent(), /물은 평소와 비교해 얼마나 마셨나요\?미확인/);
    assert.doesNotMatch(await page.locator('.review-details').textContent(), /마셨나요\?미확인 \(모르겠어요\)/);
    await submit();

    await page.reload();
    await startLeo();
    await page.locator('#complaint').fill('어제 두 번 토했어요. 오늘 한 번 토한 것 같아요. 사료를 절반만 먹었어요.');
    await action('next');
    await action('confirm-candidates');
    await action('next');
    assert.equal(await page.locator(':focus').evaluate(field => field.labels[0].textContent), '오늘 몇 번 토했나요?');
    await page.getByLabel('오늘 몇 번 토했나요?', {exact:true}).fill('두세 번');
    await action('save-answer');
    await page.getByLabel('오늘 몇 번 토했나요?', {exact:true}).fill('두세 번');
    await action('save-answer');
    await page.getByLabel('처음 토한 때가 언제였나요?', {exact:true}).fill('어제');
    await action('save-answer');
    await action('next');
    await submit();
    await openReview();
    assert.match(await page.locator('#review-hpi').inputValue(), /오늘 몇 번 토했나요\? 미확인 \(모르겠어요\)/);
    assert.match(await page.locator('.missing-box').textContent(), /오늘 몇 번 토했나요/);

    for (const confirmWater of [true, false]) {
      await page.reload();
      await startLeo();
      await page.locator('#complaint').fill('구토했어요. 물은 평소와 같아요.');
      await action('next');
      const water = page.locator('[data-candidate="water"]');
      assert.equal(await water.inputValue(), '물은 평소와 같아요');
      assert.equal(await page.locator('[data-current]').getAttribute('id'), 'q-vomit-onset');
      if (confirmWater) {
        await action('confirm-candidates');
        assert.equal(await water.count(), 0);
      }
      await action('next');
      assert.equal(await page.locator(':focus').getAttribute('id'), 'q-vomit-onset');
      for (const id of ['vomit-onset','vomit-count','meal']) {
        assert.equal(await page.locator('[data-current]').getAttribute('id'), 'q-'+id);
        await action('unknown-answer');
      }
      await action('next');
      await page.locator('.review-details summary').click();
      const waterAnswer = confirmWater ? '물은 평소와 같아요' : '미확인';
      assert.ok((await page.locator('.review-details').textContent()).includes('물은 평소와 비교해 얼마나 마셨나요?'+waterAnswer));
      await submit();
    }

    const { leoCases } = await import('../test/leo-cases.mjs');
    await page.reload();
    await startLeo();
    await page.locator('#complaint').fill(leoCases.find(scenario => scenario.id === 'past').complaint);
    await action('next');
    assert.equal(await page.locator('[data-candidate$="-onset"]').inputValue(), '오늘 아침');
    await action('confirm-candidates');
    assert.equal(await page.locator('[data-current]').getAttribute('id'), 'q-meal');
    await action('unknown-answer');
    await action('next');
    await submit();
    await openReview();
    assert.match(await page.locator('#review-hpi').inputValue(), /메스꺼움의 첫 증상은 언제였나요\? 오늘 아침/);
    assert.deepEqual(errors, []);
    await verifyCloud(browser, worker);
    await verifyCloud(browser, worker, true);
  } finally {
    await browser?.close();
  }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
