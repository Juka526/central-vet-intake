import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { QUESTION_VERSION, RISKS, draft, intakeQuestions, resolveQuestionAnswer, validateIntake } from '../lib/engine.mjs';
import { request as pages } from '../pages/demo.mjs';
import { createApplication } from '../server.mjs';
import { fixture } from './fixture.mjs';
import { leoCases } from './leo-cases.mjs';

const short = '어제 저녁부터 두 번 토했어요. 사료를 절반만 먹었어요.';
const dated = '어제 두 번 토했어요. 오늘 한 번 토했어요. 설사는 오늘 세 번 했어요. 둘 다 어제부터였어요. 사료를 절반만 먹었어요.';
const multiple = '어제부터 두 번 토했어요. 오늘 아침 기침하고 소변 양이 줄었고, 걸을 때 절뚝거려요. 사료를 절반만 먹었어요.';

function intake(complaint, overrides) {
  return {...fixture({petId:'demo-leo',complaint}), questionVersion:QUESTION_VERSION,
    categories:['digestive'], answers:{}, ...overrides};
}
function confirm(input) {
  for (const slot of intakeQuestions(input)) if (slot.candidate) input.answers[slot.id] = slot.candidate.value;
  return input;
}
function remaining(input) {
  return intakeQuestions(input).filter(slot => slot.required && !slot.answer);
}

test('짧은 레오 사례는 확인 후 0~2개 질문, 선택 질문은 제출을 막지 않음', () => {
  const input = intake(short);
  assert.match(validateIntake(input), /후속 질문/);
  confirm(input);
  assert.deepEqual(remaining(input), []);
  assert.equal(validateIntake(input), null);
  for (const id of ['water','activity','stool','meds','history']) {
    const slot = intakeQuestions(input).find(slot => slot.id === id);
    assert.equal(slot.answer, '', id);
    assert.equal(slot.candidate, null, id);
  }
  for (const id of ['vomit-onset','vomit-count','meal']) {
    const answers = {...input.answers};
    delete answers[id];
    assert.match(validateIntake({...input,answers}), /후속 질문/, id);
  }
  assert.deepEqual(remaining(confirm(intake('어제부터 토했어요.'))).map(slot => slot.label),
    ['이번에 몇 번 토했나요?','밥은 평소와 비교해 얼마나 먹었나요?']);
});

test('음수 후보를 건너뛰면 답변 없이 미확인으로 남는다', () => {
  const input = confirm(intake(short + ' 물은 평소와 같아요.'));
  delete input.answers.water;
  const water = intakeQuestions(input).find(slot => slot.id === 'water');
  assert.ok(water.candidate);
  assert.equal(water.required, false);
  assert.equal(water.answer, '');
  assert.equal(validateIntake(input), null);
  assert.ok(draft(input).missing.includes(water.label));
  assert.ok(draft(input).hpi.includes(water.label + ' 미확인\n'));
});

test('같은 분류의 증상과 날짜별 횟수 정정을 독립적으로 유지', () => {
  const input = confirm(intake(dated));
  const slots = intakeQuestions(input);
  const counts = slots.filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(slot => [slot.label,slot.answer]), [
    ['어제 몇 번 토했나요?','2회'], ['오늘 몇 번 토했나요?','1회'], ['오늘 설사가 몇 번 있었나요?','3회'],
  ]);
  assert.equal(slots.find(slot => slot.id === 'vomit-onset').answer,'어제');
  assert.equal(slots.find(slot => slot.id === 'diarrhea-onset').answer,'어제');
  input.answers[counts[0].id] = '4회';
  input.answers.history = '모르겠어요';
  input.answers.meds = '없어요';
  assert.deepEqual(remaining(input), []);
  const result = draft(input);
  assert.match(result.hpi, /어제 몇 번 토했나요\? 4회 \(보호자 정정\)/);
  assert.match(result.hpi, /오늘 몇 번 토했나요\? 1회/);
  assert.match(result.hpi, /오늘 설사가 몇 번 있었나요\? 3회/);
  assert.match(result.hpi, /현재 먹는 약이나 영양제가 있나요\? 없어요/);
  assert.match(result.soapS, /이전에 진단받은 질환이 있나요\? 미확인 \(모르겠어요\)/);
  assert.equal(intakeQuestions(input).filter(slot => slot.id === 'meal').length,1);
  assert.equal(intakeQuestions(input).filter(slot => slot.id === 'meds').length,1);
  assert.equal(intakeQuestions(input).filter(slot => slot.id === 'history').length,1);
  const selected = intake(short,{symptomSelections:['vomit','diarrhea']});
  assert.ok(remaining(selected).some(slot => slot.id === 'diarrhea-onset'));
  assert.ok(remaining(selected).some(slot => slot.id === 'diarrhea-count'));
  assert.match(validateIntake({...selected,symptomSelections:['cough']}), /하위 증상/);
  const separate = confirm(intake('어제부터 구토했어요. 설사도 했어요.'));
  assert.equal(separate.answers['diarrhea-onset'],undefined);
});

test('한 문장 안의 날짜별 횟수와 증상별 횟수도 각각 유지', () => {
  const shorthand = confirm(intake('어제 두 번 오늘 한 번 토했어요.'));
  assert.deepEqual(intakeQuestions(shorthand).filter(slot => slot.answer && slot.id.includes('-count'))
    .map(slot => [slot.label,slot.answer]), [['어제 몇 번 토했나요?','2회'],['오늘 몇 번 토했나요?','1회']]);
  const combined = confirm(intake('구토 두 번과 설사 세 번 했어요.'));
  assert.equal(combined.answers['vomit-count'],'2회');
  assert.equal(combined.answers['diarrhea-count'],'3회');
  const uncertainToday = confirm(intake('어제 두 번 오늘 한 번 토한 것 같아요.'));
  assert.ok(remaining(uncertainToday).some(slot => slot.label === '오늘 몇 번 토했나요?'));
  assert.ok(intakeQuestions(uncertainToday).some(slot => slot.label === '어제 몇 번 토했나요?' && slot.answer === '2회'));
  const ambiguous = confirm(intake('어제나 오늘 한 번 토했어요.'));
  assert.ok(remaining(ambiguous).some(slot => slot.id === 'vomit-count'));
});

test('과거와 부정 표현은 현재 횟수 후보가 되지 않으며 위험 원문은 유지', () => {
  const input = confirm(intake('지난달에 경련으로 두 번 쓰러졌어요. 오늘은 구토하지 않았고 숨쉬기 힘들어하는 모습은 없어요.'));
  const slots = intakeQuestions(input);
  assert.ok(slots.every(slot => !/^(neuro|breath|vomit)-/.test(slot.id)));
  assert.ok(draft(input).flags.some(flag => flag.id === 'collapse' && flag.level === 'candidate'));
  assert.ok(draft(input).flags.some(flag => flag.id === 'breathing' && flag.level === 'candidate'));
});

test('다른 분류를 누락하지 않고 답한 하위 항목만 제외', () => {
  const input = confirm(intake(multiple,{categories:['digestive','respiratory','urinary','mobility']}));
  assert.deepEqual(remaining(input).map(slot => slot.id).sort(), [
    'cough-onset','limb-location','limb-onset','urine-frequency','urine-onset',
    intakeQuestions(input).find(slot => slot.id.startsWith('cough-count-')).id,
  ].sort());
  assert.ok(input.answers['urine-amount']);
  assert.ok(input.answers['limb-walking']);
  for (const slot of remaining(input)) {
    const answers = {...input.answers};
    for (const other of remaining(input)) if (other.id !== slot.id) answers[other.id] = '모르겠어요';
    assert.match(validateIntake({...input,answers}), /후속 질문/, slot.id);
  }
  const selected = intake(short,{categories:['digestive','mobility','urinary']});
  assert.ok(remaining(selected).some(slot => slot.id === 'limb-location'));
  assert.ok(remaining(selected).some(slot => slot.id === 'urine-amount'));
});

test('불확실 답을 한 번 되묻고 명시적 모름과 없음은 구별', () => {
  assert.deepEqual(resolveQuestionAnswer('글쎄요'), {answer:'',clarify:true});
  assert.deepEqual(resolveQuestionAnswer('아마 어제',true), {answer:'모르겠어요',clarify:false});
  assert.deepEqual(resolveQuestionAnswer('모르겠어요'), {answer:'모르겠어요',clarify:false});
  assert.deepEqual(resolveQuestionAnswer('없어요'), {answer:'없어요',clarify:false});
  assert.deepEqual(resolveQuestionAnswer('평소의 절반 정도'), {answer:'평소의 절반 정도',clarify:false});
  const input = confirm(intake('아마 어제부터 두 번 토했어요. 밥을 먹었는지는 모르겠어요.'));
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-onset','vomit-count','meal']);
});

test('재진의 약·경과는 방문에서 한 번 확인하고 위험 8항목은 직접 응답', () => {
  const input = confirm(intake('지난 진료 뒤 이틀은 괜찮았는데 오늘 아침부터 한 번 토했어요. 현재 먹는 약이나 영양제는 없어요. 사료를 절반만 먹었어요.',{visitType:'return'}));
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-course','history']);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  for (const {id} of RISKS) {
    const risks = {...input.risks};
    delete risks[id];
    assert.match(validateIntake({...input,risks}), /위험 징후/);
  }
  assert.equal(validateIntake(input),null);
});

test('Pages 접수·조회에서 기존/새 형식과 보호자 정정을 보존', () => {
  const input = confirm(intake(dated));
  input.answers['vomit-onset'] = '그제';
  const incomplete = {...input,risks:{}};
  assert.throws(() => pages('/api/intakes',{method:'POST',body:incomplete}), /위험 징후/);
  const old = pages('/api/intakes',{method:'POST',body:fixture()});
  const receipt = pages('/api/intakes',{method:'POST',body:input});
  pages('/api/login',{method:'POST',body:{role:'vet'}});
  try {
    const record = pages('/api/intakes/'+receipt.id);
    assert.equal(record.questionVersion,QUESTION_VERSION);
    assert.match(record.draft.hpi,/그제 \(보호자 정정\)/);
    assert.match(pages('/api/intakes/'+old.id).draft.hpi,/언제부터 시작됐나요/);
  } finally {
    pages('/api/logout');
  }
});

test('로컬 서버 HTTP 처리기에서 위험 응답 검증 후 질문 상태로 초안 작성', async () => {
  const app = createApplication({vetCode:'fictional-test-code'});
  const handle = app.server.listeners('request')[0];
  let cookie, csrf;
  async function call(url,method='GET',body) {
    const headers = {host:'localhost','content-type':'application/json',cookie,'x-csrf-token':csrf};
    const req = Object.assign(Readable.from(body ? [Buffer.from(JSON.stringify(body))] : []),
      {url,method,headers,socket:{remoteAddress:'127.0.0.1'}});
    let status, data;
    await handle(req,{
      setHeader(name,value) { if (name === 'Set-Cookie') cookie = value.split(';')[0]; },
      writeHead(code) { status=code; },
      end(raw) { data=JSON.parse(raw); },
    });
    if (data.csrf) csrf=data.csrf;
    return {status,data};
  }
  try {
    await call('/api/session');
    const input = confirm(intake(short));
    input.answers['vomit-count'] = '1회';
    assert.equal((await call('/api/intakes','POST',{...input,risks:{}})).status,400);
    const receipt = await call('/api/intakes','POST',input);
    assert.equal(receipt.status,201);
    assert.equal((await call('/api/login','POST',{role:'vet',code:'fictional-test-code'})).status,200);
    const record = await call('/api/intakes/'+receipt.data.id);
    assert.equal(record.status,200);
    assert.equal(record.data.answers['vomit-count'],'1회');
    assert.match(record.data.draft.soapS,/1회 \(보호자 정정\)/);
  } finally {
    app.close();
  }
});

for (const report of ['오늘 한 번 토한 것 같아요', '오늘은 몇 번인지 모르겠어요']) {
  test(`불확실한 날짜별 횟수는 필수이며 Pages 초안에 미확인으로 남는다 (${report})`, () => {
    const input = confirm(intake(`어제 두 번 토했어요. ${report}. 사료를 절반만 먹었어요.`));
    input.answers['vomit-onset'] = '어제';
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
    const [today] = remaining(input);
    assert.equal(today.label, '오늘 몇 번 토했나요?');
    assert.equal(today.candidate, null);
    input.answers[today.id] = '모르겠어요';
    const receipt = pages('/api/intakes',{method:'POST',body:input});
    pages('/api/login',{method:'POST',body:{role:'vet'}});
    try {
      const { draft: result } = pages('/api/intakes/'+receipt.id);
      assert.ok(result.missing.includes(today.label));
      assert.ok(result.timeline.some(slot => slot.label === today.label && slot.text === '미확인 (모르겠어요)'));
      assert.ok(result.timeline.some(slot => slot.label === '어제 몇 번 토했나요?' && slot.text === '2회'));
    } finally {
      pages('/api/logout');
    }
  });
}

test('문장으로 연결한 어제와 달력 날짜의 횟수를 독립적으로 확인하고 정정한다', () => {
  const input = confirm(intake('어제 두 번 토했고 11월 25일 한 번 토했어요. 사료를 절반만 먹었어요.'));
  const counts = () => intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts().map(slot => [slot.label,slot.answer,slot.required]), [
    ['어제 몇 번 토했나요?', '2회', true],
    ['11월 25일 몇 번 토했나요?', '1회', true],
  ]);
  const [, later] = counts();
  input.answers[later.id] = '3회';
  input.corrections = [later.id];
  input.answers['vomit-onset'] = '어제';
  assert.equal(validateIntake(input), null);
  assert.deepEqual(counts().map(slot => slot.answer), ['2회','3회']);
  assert.ok(draft(input).timeline.some(slot => slot.label === later.label && slot.text === '3회 (보호자 정정)'));
});

test('선택한 구토와 설사에 명시적으로 공유한 시작 시점을 연결한다', () => {
  const selections = {symptomSelections:['vomit','diarrhea']};
  const input = confirm(intake('둘 다 어제부터였어요. 사료를 절반만 먹었어요.', selections));
  assert.deepEqual(intakeQuestions(input).filter(slot => slot.id.endsWith('-onset')).map(slot => [slot.id,slot.answer]), [
    ['vomit-onset','어제'], ['diarrhea-onset','어제'],
  ]);
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-count','diarrhea-count']);
  const unshared = intake('어제부터였어요. 사료를 절반만 먹었어요.', selections);
  assert.ok(intakeQuestions(unshared).filter(slot => slot.id.endsWith('-onset')).every(slot => !slot.candidate));
});

test('언젠가는 시작 시점으로 확정하지 않고 한 번 더 확인한다', () => {
  const input = confirm(intake('어제 두 번 토했어요. 사료를 절반만 먹었어요.'));
  const [slot] = remaining(input);
  assert.equal(slot.id, 'vomit-onset');
  assert.deepEqual(resolveQuestionAnswer('언젠가',false,false,slot), {answer:'',clarify:true});
  assert.deepEqual(resolveQuestionAnswer('오늘 오전',true,false,slot), {answer:'오늘 오전',clarify:false});
  input.answers[slot.id] = '언젠가';
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[slot.id] = resolveQuestionAnswer('언젠가',true,false,slot).answer;
  assert.equal(input.answers[slot.id], '모르겠어요');
  assert.equal(validateIntake(input), null);
  assert.ok(draft(input).missing.includes(slot.label));
});

test('괜찮아요는 구토 시작 시점으로 확정하지 않고 재확인한다', () => {
  const input = confirm(intake('어제 두 번 토했어요. 사료를 절반만 먹었어요.'));
  const [slot] = remaining(input);
  assert.equal(slot.id, 'vomit-onset');
  assert.deepEqual(resolveQuestionAnswer('괜찮아요',false,false,slot), {answer:'',clarify:true});
  input.answers[slot.id] = '괜찮아요';
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /시작 시점/);
  input.answers[slot.id] = resolveQuestionAnswer('괜찮아요',true,false,slot).answer;
  assert.equal(input.answers[slot.id], '모르겠어요');
  const { id } = pages('/api/intakes',{method:'POST',body:input});
  pages('/api/login',{method:'POST',body:{role:'vet'}});
  try {
    assert.ok(pages('/api/intakes/'+id).draft.missing.includes(slot.label));
  } finally {
    pages('/api/logout');
  }
});

test('재발과 악화가 같은 절에 있어도 오늘 횟수는 필수다', () => {
  const input = confirm(intake('그제부터 토했어요. 어제 두 번 토했어요. 오늘도 토했는데 점점 심해졌어요. 사료를 절반만 먹었어요.', {visitType:'return'}));
  const slots = intakeQuestions(input);
  assert.equal(slots.find(slot => slot.label === '어제 몇 번 토했나요?')?.answer, '2회');
  assert.equal(slots.find(slot => slot.label === '구토 관찰 시점 · 오늘')?.answer, '오늘');
  assert.equal(slots.find(slot => slot.label.startsWith('오늘 구토 경과'))?.answer, '점점 심해졌어요');
  const today = slots.find(slot => slot.label === '오늘 몇 번 토했나요?');
  assert.equal(today?.required, true);
  assert.equal(today.answer, '');
  for (const slot of remaining(input)) if (slot.id !== today.id) input.answers[slot.id] = '모르겠어요';
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[today.id] = '1회';
  const { id } = pages('/api/intakes',{method:'POST',body:input});
  pages('/api/login',{method:'POST',body:{role:'vet'}});
  try {
    assert.match(pages('/api/intakes/'+id).draft.hpi, /오늘 몇 번 토했나요\? 1회/);
  } finally {
    pages('/api/logout');
  }
});

test('악화 시점과 처음 구토한 시점을 따로 확인한다', () => {
  const slots = intakeQuestions(intake('어제 두 번 구토했어요. 오늘부터 구토가 심해졌어요.'));
  assert.equal(slots.find(slot => slot.id === 'vomit-onset').candidate, null);
  assert.ok(slots.some(slot => slot.label === '구토 관찰 시점 · 어제' && slot.candidate.value === '어제'));
  assert.ok(slots.some(slot => slot.label.startsWith('오늘 구토 경과') && slot.candidate.value === '심해졌어요'));
  assert.ok(!slots.some(slot => slot.label === '오늘 몇 번 토했나요?'));
});

test('과거 위험 표현과 현재 메스꺼움 시작 시점을 따로 확인한다', () => {
  const input = confirm(intake(leoCases.find(scenario => scenario.id === 'past').complaint));
  assert.equal(intakeQuestions(input).find(slot => slot.id.endsWith('-onset')).answer, '오늘 아침');
  assert.deepEqual(remaining(input).map(slot => slot.id), ['meal']);
  assert.ok(draft(input).flags.some(flag => flag.id === 'collapse' && flag.level === 'candidate'));
});

test('쉼표 앞의 날짜별 횟수는 뒤에 명시된 증상에 연결되고 Pages 접수에 필요하다', () => {
  for (const [phrase, expected] of [['두 번', '2회'], ['두세 번', null]]) {
    const input = confirm(intake(`어제는 ${phrase}, 오늘은 한 번 구토했고 오늘 설사는 세 번 했어요. 둘 다 어제부터였어요. 사료를 절반만 먹었어요.`));
    const slots = intakeQuestions(input);
    const yesterday = slots.find(slot => slot.label === '어제 몇 번 토했나요?');
    assert.ok(yesterday?.required);
    assert.equal(yesterday.candidate?.value ?? null, expected);
    assert.equal(slots.find(slot => slot.label === '오늘 몇 번 토했나요?').answer, '1회');
    assert.equal(slots.find(slot => slot.label === '오늘 설사가 몇 번 있었나요?').answer, '3회');
    delete input.answers[yesterday.id];
    assert.deepEqual(remaining(input).map(slot => slot.id), [yesterday.id]);
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
    input.answers[yesterday.id] = '4회';
    assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
    assert.match(draft(input).hpi, /어제 몇 번 토했나요\? 4회/);
  }
});

test('복합 증상 절에서도 날짜별 필수 횟수 누락을 Pages 접수에서 거부한다', () => {
  const input = confirm(intake('어제 두 번 토했어요. 오늘 아침에 다시 토했는데 기침도 했어요. 사료를 절반만 먹었어요.'));
  const pending = remaining(input);
  assert.deepEqual(pending.map(slot => slot.label).sort(), [
    '오늘 아침 몇 번 토했나요?', '이번에 기침이 몇 번 있었나요?', '기침의 첫 증상은 언제였나요?', '처음 토한 때가 언제였나요?',
  ].sort());
  assert.ok(intakeQuestions(input).some(slot => slot.label === '어제 몇 번 토했나요?' && slot.answer === '2회'));
  const today = pending.find(slot => slot.label === '오늘 아침 몇 번 토했나요?');
  for (const slot of pending) if (slot !== today) input.answers[slot.id] = '모르겠어요';
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[today.id] = '모르겠어요';
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
});

test('불명확한 횟수 정정은 한 번 재확인하고 접수 검증에서도 확정을 막는다', () => {
  const input = confirm(intake(short));
  const slot = intakeQuestions(input).find(slot => slot.id === 'vomit-count');
  for (const value of ['두세 번','서너 회','최소 두 번','2회 정도','2~3회','많이']) {
    assert.deepEqual(resolveQuestionAnswer(value,false,false,slot), {answer:'',clarify:true}, value);
    assert.deepEqual(resolveQuestionAnswer(value,true,false,slot), {answer:'모르겠어요',clarify:false}, value);
    input.answers[slot.id] = value;
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/, value);
  }
  const answer = resolveQuestionAnswer('세 번 토했어요',true,false,slot);
  assert.deepEqual(answer, {answer:'세 번 토했어요',clarify:false});
  input.answers[slot.id] = answer.answer;
  assert.equal(validateIntake(input),null);
  assert.match(draft(input).hpi,/세 번 토했어요 \(보호자 정정\)/);
  input.answers[slot.id] = resolveQuestionAnswer('두세 번',true,false,slot).answer;
  assert.equal(validateIntake(input),null);
  assert.ok(draft(input).missing.includes(slot.label));
});

test('재진의 별도 날짜 경과 문장을 직전 단일 증상과 연결한다', () => {
  const input = confirm(intake('어제부터 구토했어요. 오늘 두 번 토했어요. 오늘은 좋아졌어요.',{visitType:'return'}));
  const course = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-course'));
  assert.deepEqual(course.map(slot => [slot.label,slot.answer,slot.required]), [
    ['오늘 구토 경과는 어떻게 달라졌나요?', '좋아졌어요', true],
  ]);
  assert.ok(!remaining(input).some(slot => slot.id.startsWith('vomit-course')));
  const mixed = intake('구토와 기침이 있었어요. 오늘은 좋아졌어요.',{visitType:'return'});
  assert.ok(intakeQuestions(mixed).filter(slot => slot.id.endsWith('-course')).every(slot => !slot.candidate));
});

// These expectations are annotated from the Leo stories and the #5 question policy.
const leoRequiredSlots = {
  negation: { candidates: ['digestive-onset','meal'], pending: [] },
  past: { candidates: ['digestive-onset'], pending: ['meal'] },
  unknown: { candidates: [], pending: ['vomit-onset','vomit-count','meal'] },
  multiple: {
    candidates: ['vomit-onset','vomit-count','urine-amount','limb-walking'],
    pending: ['cough-onset','오늘 아침 기침이 몇 번 있었나요?','urine-onset','urine-frequency','limb-onset','limb-location','meal'],
  },
  correction: { candidates: ['vomit-onset','vomit-count','meal'], pending: [] },
  return: {
    candidates: ['vomit-onset','vomit-count','meds','followup'],
    pending: ['vomit-course','meal','history'],
  },
};
const directRisks = ['breathing','collapse','bleeding','toxin','urine','abdomen','heat','birth'];

test('레오 기준선 6개 사례에서 고정된 필수 하위 질문과 직접 위험 확인을 검사한다', async t => {
  assert.deepEqual(RISKS.map(risk => risk.id).sort(), [...directRisks].sort());
  for (const scenario of leoCases) {
    await t.test(scenario.id, () => {
      const { candidates, pending } = leoRequiredSlots[scenario.id];
      const input = intake(scenario.original ?? scenario.complaint, {visitType:scenario.visitType ?? 'first'});
      const slots = intakeQuestions(input);
      const key = slot => slot.id.startsWith('cough-count-') ? slot.label : slot.id;
      assert.deepEqual(slots.filter(slot => slot.required && slot.candidate).map(key).sort(), [...candidates].sort());
      assert.deepEqual(remaining(confirm(input)).map(key).sort(), [...pending].sort());
      if (scenario.id === 'correction') input.answers['vomit-count'] = '1회';
      for (const id of pending) {
        const slot = slots.find(slot => key(slot) === id);
        input.answers[slot.id] = '모르겠어요';
      }
      assert.deepEqual(remaining(input), []);
      assert.equal(validateIntake(input), null);
      for (const id of [...candidates,...pending]) {
        const answers = {...input.answers};
        delete answers[slots.find(slot => key(slot) === id).id];
        assert.match(validateIntake({...input,answers}), /후속 질문/, id);
      }
      for (const id of directRisks) {
        const risks = {...input.risks};
        delete risks[id];
        assert.match(validateIntake({...input,risks}), /위험 징후/, id);
      }
      if (scenario.id === 'correction') assert.match(draft(input).hpi,/1회 \(보호자 정정\)/);
    });
  }
});

test('같은 날짜의 오전과 저녁 관찰은 각각 필수 횟수를 가지며 부분 정정을 보존한다', () => {
  const input = confirm(intake('어제 처음 토했어요. 11월 24일 오전에 두 번 토했어요. 11월 24일 저녁에 한 번 토했어요. 밥은 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(slot => [slot.label,slot.answer]), [
    ['11월 24일 오전 몇 번 토했나요?', '2회'], ['11월 24일 저녁 몇 번 토했나요?', '1회'],
  ]);
  for (const slot of counts) {
    const answers = {...input.answers};
    delete answers[slot.id];
    assert.match(validateIntake({...input, answers}), /후속 질문/);
  }
  input.answers[counts[0].id] = '3회';
  assert.deepEqual(remaining(input), []);
  assert.equal(validateIntake(input), null);
  assert.match(draft(input).hpi, /11월 24일 오전 몇 번 토했나요\? 3회 \(보호자 정정\)/);
  assert.match(draft(input).hpi, /11월 24일 저녁 몇 번 토했나요\? 1회\n/);
});

test('구토 뒤에 호흡 변화가 이어져도 두 날짜의 횟수와 직접 위험 확인을 요구한다', () => {
  const input = confirm(intake('그제부터 구토했어요. 어제 두 번 토했어요. 오늘 다시 두 번 토하고 호흡도 힘들어했어요. 밥은 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(slot => [slot.label,slot.answer]), [
    ['어제 몇 번 토했나요?', '2회'], ['오늘 몇 번 토했나요?', '2회'],
  ]);
  assert.deepEqual(remaining(input).map(slot => slot.id), ['breath-onset']);
  assert.match(validateIntake(input), /후속 질문/);
  input.answers['breath-onset'] = '모르겠어요';
  assert.equal(validateIntake(input), null);
  for (const slot of counts) {
    const answers = {...input.answers};
    delete answers[slot.id];
    assert.throws(() => pages('/api/intakes', {method:'POST',body:{...input, answers}}), /후속 질문/);
  }
  const risks = {...input.risks};
  delete risks.breathing;
  assert.match(validateIntake({...input, risks}), /위험 징후/);
});

test('식사량의 방향이나 양을 알 수 없는 답은 한 번 되묻고 미확인으로 남긴다', () => {
  const input = confirm(intake('어제부터 두 번 토했어요.'));
  const [meal] = remaining(input);
  const vague = '평소랑 조금 달라요';
  assert.deepEqual(resolveQuestionAnswer(vague,false,false,meal), {answer:'',clarify:true});
  assert.deepEqual(resolveQuestionAnswer('평소의 절반 정도',true,false,meal), {answer:'평소의 절반 정도',clarify:false});
  input.answers.meal = vague;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers.meal = resolveQuestionAnswer(vague,true,false,meal).answer;
  assert.equal(validateIntake(input), null);
  assert.ok(draft(input).missing.includes(meal.label));
  assert.match(draft(input).hpi, /먹었나요\? 미확인 \(모르겠어요\)/);
});
