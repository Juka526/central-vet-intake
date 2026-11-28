import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { QUESTION_VERSION, RISKS, clarification, draft, intakeQuestions, resolveQuestionAnswer, validateIntake } from '../lib/engine.mjs';
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
    ['어제 몇 번 토했나요?', ''],
    ['11월 24일 오전 몇 번 토했나요?', '2회'], ['11월 24일 저녁 몇 번 토했나요?', '1회'],
  ]);
  input.answers[counts[0].id] = '모르겠어요';
  for (const slot of counts) {
    const answers = {...input.answers};
    delete answers[slot.id];
    assert.match(validateIntake({...input, answers}), /후속 질문/);
  }
  input.answers[counts[1].id] = '3회';
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

test('방금 추가 구토는 오늘 누적 횟수와 별도로 확인하고 Pages에서 필수로 검사한다', () => {
  const input = confirm(intake('어제 두 번 토했어요. 오늘 세 번 토했어요. 방금 한 번 더 토했어요. 사료를 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({label,answer}) => [label,answer]), [
    ['어제 몇 번 토했나요?', '2회'], ['오늘 몇 번 토했나요?', '3회'], ['방금 몇 번 토했나요?', '1회'],
  ]);
  assert.ok(intakeQuestions(input).some(slot => slot.label === '구토 관찰 시점 · 방금' && slot.answer === '방금'));
  input.answers['vomit-onset'] = '모르겠어요';
  const recent = counts.at(-1);
  delete input.answers[recent.id];
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[recent.id] = '2회';
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  assert.match(draft(input).hpi, /방금 몇 번 토했나요\? 2회 \(보호자 정정\)/u);
  assert.match(draft(input).hpi, /오늘 몇 번 토했나요\? 3회/u);
});

test('한 문장에 날짜와 횟수가 있는 구토와 설사를 각각 후보로 확인한다', () => {
  const input = confirm(intake('어제 구토 2회와 오늘 설사 3회. 사료를 절반만 먹었어요.'));
  assert.deepEqual(intakeQuestions(input).filter(slot => slot.id.includes('-count')).map(({label,answer}) => [label,answer]), [
    ['어제 몇 번 토했나요?', '2회'], ['오늘 설사가 몇 번 있었나요?', '3회'],
  ]);
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-onset','diarrhea-onset']);
});

test('모두가 설사 횟수를 수식하면 시작 시점을 구토와 공유하지 않는다', () => {
  const input = confirm(intake('구토와 설사가 있었어요. 어제부터 설사를 모두 세 번 했어요. 사료를 절반만 먹었어요.'));
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-onset','vomit-count']);
  assert.equal(input.answers['diarrhea-onset'], '어제');
  assert.equal(input.answers['diarrhea-count'], '3회');
});

test('방향이나 양이 없는 음수 답은 한 번 되묻고 여전히 모호하면 미확인으로 남긴다', () => {
  const input = confirm(intake(short));
  const water = intakeQuestions(input).find(slot => slot.id === 'water');
  for (const value of ['평소랑 달라요', '물은 평소와 조금 달랐어요']) {
    assert.deepEqual(resolveQuestionAnswer(value,false,false,water), {answer:'',clarify:true});
    input.answers.water = resolveQuestionAnswer(value,true,false,water).answer;
    assert.match(draft(input).hpi, /물은 평소와 비교해 얼마나 마셨나요\? 미확인/u);
    assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  }
  for (const value of ['평소보다 덜 마셨어요','평소와 같아요','없어요']) {
    assert.deepEqual(resolveQuestionAnswer(value,true,false,water), {answer:value,clarify:false});
  }
});


test('같은 문장의 오전·저녁 관찰은 같은 날짜의 별도 필수 횟수로 남긴다', () => {
  const input = confirm(intake('어제부터 토했어요. 어제 두 번 토했어요. 오늘 오전 8시와 저녁 7시에 또 토했어요. 사료를 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({label,answer}) => [label,answer]), [
    ['어제 몇 번 토했나요?', '2회'], ['오늘 오전 8시 몇 번 토했나요?', ''], ['오늘 저녁 7시 몇 번 토했나요?', ''],
  ]);
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[counts[1].id] = '1회';
  input.answers[counts[2].id] = '모르겠어요';
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  assert.match(draft(input).hpi, /오늘 저녁 7시 몇 번 토했나요\? 미확인/u);

  const each = confirm(intake('어제부터 토했어요. 오늘 오전 8시와 저녁 7시에 한 번씩 토했어요. 사료를 절반만 먹었어요.'));
  assert.deepEqual(intakeQuestions(each).filter(slot => slot.id.startsWith('vomit-count')).map(slot => slot.answer), ['1회','1회']);
});

test('먹었다는 사실이나 안심 표현만으로 양이 확인되지는 않는다', () => {
  const input = confirm(intake(short));
  for (const [id,vague,clear] of [['meal','밥 먹었어요','평소보다 적게 먹었어요'], ['water','괜찮아요','물은 150mL 마셨어요']]) {
    const slot = intakeQuestions(input).find(item => item.id === id);
    assert.deepEqual(resolveQuestionAnswer(vague,false,false,slot), {answer:'',clarify:true});
    assert.deepEqual(resolveQuestionAnswer(clear,true,false,slot), {answer:clear,clarify:false});
    input.answers[id] = vague;
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
    input.answers[id] = resolveQuestionAnswer(vague,true,false,slot).answer;
    assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
    assert.ok(draft(input).missing.includes(slot.label));
  }
});

test('접속 조사로 연결한 날짜별 횟수는 각각 확인하고 한쪽만 정정할 수 있다', () => {
  const input = confirm(intake('어제부터 토했어요. 어제 두 번이랑 오늘 한 번 토했어요. 밥을 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({label,answer}) => [label,answer]), [
    ['어제 몇 번 토했나요?', '2회'], ['오늘 몇 번 토했나요?', '1회'],
  ]);
  assert.deepEqual(remaining(input), []);
  for (const slot of counts) {
    const answers = {...input.answers};
    delete answers[slot.id];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  input.answers[counts[0].id] = '3회';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  pages('/api/login',{method:'POST',body:{role:'vet'}});
  try {
    const {draft:result} = pages('/api/intakes/'+id);
    assert.match(result.hpi, /어제 몇 번 토했나요\? 3회 \(보호자 정정\)/u);
    assert.match(result.hpi, /오늘 몇 번 토했나요\? 1회\n/u);
  } finally {
    pages('/api/logout');
  }
});

test('불명확한 재진 병력은 한 번 되묻고 명시적인 없음과 미확인을 구분한다', () => {
  const input = confirm(intake(short + ' 먹는 약은 없어요. 지난 진료 이후 괜찮았어요.', {visitType:'return'}));
  const history = intakeQuestions(input).find(slot => slot.id === 'history');
  const vague = '괜찮아요';
  assert.deepEqual(resolveQuestionAnswer(vague,false,false,history), {answer:'',clarify:true});
  assert.match(clarification(history), /진단받은 질환의 이름/u);
  for (const answer of ['없어요','당뇨 진단을 받았어요']) {
    assert.deepEqual(resolveQuestionAnswer(answer,true,false,history), {answer,clarify:false});
  }
  input.answers['vomit-course'] = '모르겠어요';
  input.answers.history = vague;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /병력 후속 질문/);
  input.answers.history = resolveQuestionAnswer(vague,true,false,history).answer;
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  assert.match(draft(input).hpi, /진단받은 질환이 있나요\? 미확인 \(모르겠어요\)/u);
});

test('생략된 증상의 불확실한 날짜별 횟수도 직접 확인해야 한다', () => {
  for (const report of ['오늘은 두세 번이요.', '오늘은 횟수가 기억 안 나요.']) {
    const input = confirm(intake('어제부터 두 번 토했어요. '+report+' 사료를 절반만 먹었어요.'));
    const [today] = remaining(input);
    assert.deepEqual(remaining(input).map(slot => slot.label), ['오늘 몇 번 토했나요?']);
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
    input.answers[today.id] = '모르겠어요';
    assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
    assert.match(draft(input).hpi, /오늘 몇 번 토했나요\? 미확인/u);
  }
});

test('연결한 구토 횟수와 설사 횟수를 따로 확인하고 날짜 하나만 정정한다', () => {
  const input = confirm(intake('어제 구토 2회와 오늘 1회, 설사는 3회 했어요. 사료를 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(({label,answer}) => [label,answer]), [
    ['어제 몇 번 토했나요?', '2회'], ['오늘 몇 번 토했나요?', '1회'], ['이번에 설사가 몇 번 있었나요?', '3회'],
  ]);
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-onset','diarrhea-onset']);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  input.answers[counts[1].id] = '4회';
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  const hpi = draft(input).hpi;
  assert.match(hpi, /^어제 몇 번 토했나요\? 2회$/mu);
  assert.match(hpi, /^오늘 몇 번 토했나요\? 4회 \(보호자 정정\)$/mu);
  assert.match(draft(input).hpi, /이번에 설사가 몇 번 있었나요\? 3회\n/u);
});

test('더 관찰한 설사 횟수는 해당 날짜의 후보가 된다', () => {
  const input = confirm(intake('어제부터 설사를 했어요. 오늘 세 번 더 설사했어요. 사료를 절반만 먹었어요.'));
  assert.deepEqual(remaining(input), []);
  assert.deepEqual(intakeQuestions(input).filter(slot => slot.id.includes('-count')).map(({label,answer}) => [label,answer]), [
    ['오늘 설사가 몇 번 있었나요?', '3회'],
  ]);
});

test('다른 항목의 답과 질문의 의미를 되묻는 응답은 한 번만 명확히 되묻는다', () => {
  const input = confirm(intake('어제부터 두 번 토했어요.'));
  for (const [id,value] of [['meal','물은 평소보다 많이 마셨어요'], ['meal','물을 평소보다 많이 먹었어요'], ['stool','무슨 말이에요']]) {
    const slot = intakeQuestions(input).find(item => item.id === id);
    assert.deepEqual(resolveQuestionAnswer(value,false,false,slot), {answer:'',clarify:true});
    assert.match(clarification(slot), id === 'meal' ? /먹었나요/u : /묽거나 딱딱/u);
    assert.deepEqual(resolveQuestionAnswer(value,true,false,slot), {answer:'모르겠어요',clarify:false});
    input.answers[id] = value;
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
    input.answers[id] = resolveQuestionAnswer(value,true,false,slot).answer;
  }
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  for (const id of ['meal','water','stool']) {
    const slot = intakeQuestions(input).find(item => item.id === id);
    assert.ok(draft(input).missing.includes(slot.label));
  }
});

function readPagesDraft(id) {
  pages('/api/login',{method:'POST',body:{role:'vet'}});
  try {
    return pages('/api/intakes/'+id).draft;
  } finally {
    pages('/api/logout');
  }
}

test('뒤로 연결된 복수 증상의 날짜와 횟수를 Pages 타임라인에 유지한다', () => {
  const input = confirm(intake('어제 두 번 토한 뒤 오늘 세 번 설사했어요. 사료를 절반만 먹었어요.'));
  const expected = [
    {label:'어제 몇 번 토했나요?',text:'2회'},
    {label:'오늘 설사가 몇 번 있었나요?',text:'3회'},
  ];
  assert.deepEqual(remaining(input).map(slot => slot.id), ['vomit-onset','diarrhea-onset']);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const result = readPagesDraft(id);
  assert.deepEqual(result.timeline.filter(item => item.label.includes('몇 번')), expected);
  for (const slot of intakeQuestions(input).filter(item => item.id.includes('-count'))) {
    const answers = {...input.answers};
    delete answers[slot.id];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
});

test('다른 증상의 횟수는 재확인하고 Pages 접수에서도 구토 횟수로 인정하지 않는다', () => {
  const input = confirm(intake('어제부터 토했어요. 사료를 절반만 먹었어요.'));
  const [slot] = remaining(input);
  assert.equal(slot.id, 'vomit-count');
  for (const value of ['설사는 세 번 했어요', '설사는 몇 번 했는지 모르겠어요']) {
    assert.deepEqual(resolveQuestionAnswer(value,false,false,slot), {answer:'',clarify:true});
    input.answers[slot.id] = value;
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /횟수 후속 질문/);
    assert.deepEqual(resolveQuestionAnswer(value,true,false,slot), {answer:'모르겠어요',clarify:false});
  }
  input.answers[slot.id] = '모르겠어요';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const result = readPagesDraft(id);
  assert.match(result.hpi, /이번에 몇 번 토했나요\? 미확인/u);
});

test('이어지는 저녁 관찰의 날짜를 보존하고 어제 시작 시점은 유지한다', () => {
  const input = confirm(intake('어제 저녁 처음 토했어요. 오늘 아침에 두 번 토했고 저녁에는 한 번 더 토했어요. 사료를 절반만 먹었어요.'));
  const [firstCount] = remaining(input);
  assert.deepEqual(remaining(input).map(slot => slot.label), ['어제 저녁 몇 번 토했나요?']);
  input.answers[firstCount.id] = '모르겠어요';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const result = readPagesDraft(id);
  assert.deepEqual(result.timeline.filter(item => item.label.includes('몇 번')), [
    {label:'어제 저녁 몇 번 토했나요?',text:'미확인 (모르겠어요)'},
    {label:'오늘 아침 몇 번 토했나요?',text:'2회'},
    {label:'오늘 저녁 몇 번 토했나요?',text:'1회'},
  ]);
  assert.match(result.hpi, /처음 토한 때가 언제였나요\? 어제 저녁/u);
  assert.ok(result.timeline.some(item => item.label === '구토 관찰 시점 · 오늘 저녁' && item.text === '오늘 저녁'));
});

test('저장된 문진의 기존 저녁 답변을 검토 화면에서 계속 읽을 수 있다', () => {
  const input = confirm(intake('오늘 아침에 두 번 토했고 저녁에는 한 번 더 토했어요. 사료를 절반만 먹었어요.'));
  const slots = intakeQuestions(input);
  for (const slot of slots.filter(item => item.label.includes('오늘 저녁'))) {
    const legacyId = slot.id.replace(/(count|seen)-[^-]+$/u,
      '$1-' + Array.from('저녁', char => char.codePointAt(0).toString(36)).join('_'));
    input.answers[legacyId] = input.answers[slot.id];
    delete input.answers[slot.id];
  }
  input.answers['vomit-onset'] = '모르겠어요';
  const saved = {...input,draft:{timeline:[]}};
  assert.ok(intakeQuestions(saved).some(slot => slot.label === '저녁 몇 번 토했나요?' && slot.answer === '1회'));
  assert.throws(() => pages('/api/intakes',{method:'POST',body:saved}), /답변 형식|후속 질문/);
});

test('공통 날짜가 붙은 구토와 설사의 필수 횟수를 날짜별로 묻는다', () => {
  const input = confirm(intake('어제 구토와 설사가 있었어요. 오늘 구토와 설사가 있었어요. 사료를 절반만 먹었어요.'));
  const counts = remaining(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(slot => slot.label), [
    '어제 몇 번 토했나요?', '어제 설사가 몇 번 있었나요?',
    '오늘 몇 번 토했나요?', '오늘 설사가 몇 번 있었나요?',
  ]);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  for (const {id} of counts) {
    const answers = {...input.answers};
    delete answers[id];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')),
    counts.map(({label}) => ({label,text:'미확인 (모르겠어요)'})));
  assert.equal(counts.length,4);
  assert.ok(counts.every(slot => slot.candidate === null));
});

test('저장된 문진에서 공통 날짜가 붙은 기존 횟수 답변을 읽을 수 있다', () => {
  const saved = intake('어제 구토와 설사가 있었어요. 오늘 구토와 설사가 있었어요.',{
    draft:{timeline:[]}, answers:{'vomit-count':'2회','diarrhea-count':'3회'},
  });
  assert.deepEqual(intakeQuestions(saved).filter(slot => slot.id.includes('-count')).map(slot => slot.answer),
    ['2회','3회']);
});

test('다른 날짜의 횟수 정정은 한 번 되묻고 원래 날짜에 저장하지 않는다', () => {
  const input = confirm(intake('어제 두 번 토했어요. 오늘 한 번 토했어요. 사료를 절반만 먹었어요.'));
  const [yesterday,today] = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  input.answers['vomit-onset'] = '모르겠어요';
  input.corrections = [yesterday.id];
  const conflict = '오늘 네 번 토했어요.';
  assert.deepEqual(resolveQuestionAnswer(conflict,false,false,yesterday), {answer:'',clarify:true});
  assert.match(clarification(yesterday), /^어제/u);
  assert.deepEqual(resolveQuestionAnswer(conflict,true,false,yesterday), {answer:'모르겠어요',clarify:false});
  input.answers[yesterday.id] = conflict;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /횟수 후속 질문/);
  const corrected = resolveQuestionAnswer('어제 네 번 토했어요.',true,false,yesterday);
  assert.equal(corrected.clarify,false);
  input.answers[yesterday.id] = corrected.answer;
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const result = readPagesDraft(id);
  assert.ok(result.timeline.some(item => item.label === yesterday.label && item.text === corrected.answer+' (보호자 정정)'));
  assert.ok(result.timeline.some(item => item.label === today.label && item.text === '1회'));
});

test('선택 음수 정정 도중 건너뛰면 Pages에서 미확인으로 접수한다', () => {
  const input = confirm(intake(short + ' 물은 평소와 같아요.'));
  const water = intakeQuestions(input).find(slot => slot.id === 'water');
  assert.deepEqual(resolveQuestionAnswer('평소랑 조금 달라요',false,false,water), {answer:'',clarify:true});
  delete input.answers.water;
  input.corrections = ['water'];
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const result = readPagesDraft(id);
  assert.ok(result.missing.includes(water.label));
  assert.ok(result.hpi.includes(water.label + ' 미확인\n'));
  const risks = {...input.risks};
  delete risks[RISKS[0].id];
  assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,risks}}), /위험 징후/);
  assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,corrections:['invalid']}}), /정정한 답변/);
});


test('같은 날짜에 구토하며 설사했다고 말하면 날짜와 두 증상의 횟수를 구분한다', () => {
  const input = confirm(intake('어제 두 번 토하며 설사도 했어요. 오늘 세 번 토하며 설사도 했어요. 사료를 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(({label,answer}) => [label,answer]), [
    ['어제 몇 번 토했나요?', '2회'], ['어제 설사가 몇 번 있었나요?', ''],
    ['오늘 몇 번 토했나요?', '3회'], ['오늘 설사가 몇 번 있었나요?', ''],
  ]);
  for (const slot of remaining(input).filter(slot => !slot.id.includes('-count'))) input.answers[slot.id] = '모르겠어요';
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[counts[1].id] = '1회';
  input.answers[counts[3].id] = '모르겠어요';
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  assert.match(draft(input).hpi, /오늘 설사가 몇 번 있었나요\? 미확인/u);
});

test('다른 증상의 시작을 말하면 현재 시작 항목을 한 번 더 묻는다', () => {
  const input = confirm(intake('어제부터 토했어요. 오늘부터 설사했어요. 사료를 절반만 먹었어요.'));
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  const vomit = intakeQuestions(input).find(slot => slot.id === 'vomit-onset');
  const wrong = '설사는 오늘부터예요.';
  assert.deepEqual(resolveQuestionAnswer(wrong,false,false,vomit), {answer:'',clarify:true});
  input.answers[vomit.id] = wrong;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[vomit.id] = resolveQuestionAnswer(wrong,true,false,vomit).answer;
  assert.equal(input.answers['diarrhea-onset'], '오늘');
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
});

test('인접한 날짜의 반복 관찰은 증상 이름이 생략되어도 횟수를 확인한다', () => {
  const input = confirm(intake('어제 두 번 토했어요. 오늘도 했어요. 사료는 절반만 먹었어요.'));
  input.answers['vomit-onset'] = '어제';
  const slots = intakeQuestions(input);
  assert.equal(slots.find(slot => slot.label === '어제 몇 번 토했나요?')?.answer, '2회');
  assert.equal(slots.find(slot => slot.label === '구토 관찰 시점 · 오늘')?.answer, '오늘');
  assert.deepEqual(remaining(input).map(slot => slot.label), ['오늘 몇 번 토했나요?']);
  const [today] = remaining(input);
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[today.id] = '1회';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')), [
    {label:'어제 몇 번 토했나요?',text:'2회'},
    {label:'오늘 몇 번 토했나요?',text:'1회'},
  ]);
  for (const complaint of [
    '어제 구토와 설사가 있었어요. 오늘도 했어요.',
    '어제 두 번 토했어요. 사료를 절반만 먹었어요. 오늘도 했어요.',
    '어제 두 번 토했어요. 오늘도 밥을 먹었어요.',
  ]) {
    assert.ok(!intakeQuestions(intake(complaint)).some(slot => slot.label === '오늘 몇 번 토했나요?'), complaint);
  }
});

test('식사 횟수를 구토 횟수에 답하면 한 번 더 묻고 계속 불명확하면 미확인으로 남긴다', () => {
  const input = confirm(intake('어제부터 토했어요. 사료를 절반만 먹었어요.'));
  const [slot] = remaining(input);
  const wrong = '밥을 두 번 먹었어요';
  assert.equal(slot.id, 'vomit-count');
  assert.deepEqual(resolveQuestionAnswer(wrong,false,false,slot), {answer:'',clarify:true});
  input.answers[slot.id] = wrong;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /횟수 후속 질문/);
  const repeated = resolveQuestionAnswer(wrong,true,false,slot);
  assert.deepEqual(repeated, {answer:'모르겠어요',clarify:false});
  const retry = resolveQuestionAnswer('두 번 했어요',true,false,slot);
  assert.deepEqual(retry, {answer:'두 번 했어요',clarify:false});
  input.answers[slot.id] = repeated.answer;
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const result = readPagesDraft(id);
  assert.ok(result.timeline.some(item => item.label === slot.label && item.text === '미확인 (모르겠어요)'));
  assert.equal(input.answers.meal, '사료를 절반만 먹었어요');
});

test('처음 토한 날의 횟수와 다음 날의 생략된 횟수를 각각 확인하고 정정한다', () => {
  const input = confirm(intake('어제 처음 두 번 토했어요. 오늘 세 번 더 했어요. 사료를 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(({label,answer}) => [label,answer]), [
    ['어제 몇 번 토했나요?', '2회'], ['오늘 몇 번 토했나요?', '3회'],
  ]);
  assert.equal(input.answers['vomit-onset'], '어제');
  assert.deepEqual(remaining(input), []);
  for (const slot of counts) {
    const answers = {...input.answers};
    delete answers[slot.id];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  input.answers[counts[0].id] = '4회';
  input.corrections = [counts[0].id];
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')), [
    {label:'어제 몇 번 토했나요?',text:'4회 (보호자 정정)'},
    {label:'오늘 몇 번 토했나요?',text:'3회'},
  ]);
  const saved = {...input,draft:{timeline:[]}, answers:{'vomit-onset':'어제','vomit-count':'2회'}};
  assert.ok(intakeQuestions(saved).some(slot => slot.id === 'vomit-count' && slot.answer === '2회'));
});

test('오늘도 그랬다는 말은 이전 증상의 오늘 횟수를 필수로 남긴다', () => {
  const input = confirm(intake('어제 두 번 토했어요. 오늘도 그랬어요. 사료를 절반만 먹었어요.'));
  input.answers['vomit-onset'] = '어제';
  assert.deepEqual(remaining(input).map(slot => slot.label), ['오늘 몇 번 토했나요?']);
  const [today] = remaining(input);
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[today.id] = '모르겠어요';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')), [
    {label:'어제 몇 번 토했나요?',text:'2회'},
    {label:'오늘 몇 번 토했나요?',text:'미확인 (모르겠어요)'},
  ]);
  for (const report of ['오늘도 그랬어요.', '오늘 세 번 더 했어요.']) {
    const ambiguous = intake('어제 구토와 설사가 있었어요. ' + report);
    assert.ok(intakeQuestions(ambiguous).every(slot => !slot.label.startsWith('오늘')), report);
  }
});

test('재진 복용약이 불명확하면 약 이름을 한 번 더 묻고 미확인으로 남긴다', () => {
  const input = confirm(intake(short + ' 기존 질환은 없어요. 지난 진료 이후 괜찮았어요.', {visitType:'return'}));
  input.answers['vomit-course'] = '모르겠어요';
  const meds = intakeQuestions(input).find(slot => slot.id === 'meds');
  assert.deepEqual(resolveQuestionAnswer('괜찮아요',false,false,meds), {answer:'',clarify:true});
  assert.match(clarification(meds), /약이나 영양제의 이름/u);
  input.answers.meds = '괜찮아요';
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  const retry = resolveQuestionAnswer('괜찮아요',true,false,meds);
  assert.deepEqual(retry, {answer:'모르겠어요',clarify:false});
  for (const [answer,display] of [[retry.answer,'미확인 (모르겠어요)'],['없어요','없어요'],['영양제 A','영양제 A']]) {
    assert.deepEqual(resolveQuestionAnswer(answer,true,false,meds), {answer,clarify:false});
    input.answers.meds = answer;
    const {id} = pages('/api/intakes',{method:'POST',body:input});
    assert.ok(readPagesDraft(id).hpi.includes(meds.label + ' ' + display));
  }
});


test('시각만 이어 말하면 같은 증상의 날짜를 이어서 필수 횟수를 각각 묻는다', () => {
  const input = confirm(intake('어제 두 번 토했어요. 오늘 아침에 기침했고 저녁에 기침했어요. 사료를 절반만 먹었어요.'));
  const count = intakeQuestions(input).filter(slot => slot.id.startsWith('cough-count'));
  assert.deepEqual(count.map(({label,answer}) => [label,answer]), [
    ['오늘 아침 기침이 몇 번 있었나요?', ''], ['오늘 저녁 기침이 몇 번 있었나요?', ''],
  ]);
  for (const slot of remaining(input).filter(slot => !slot.id.startsWith('cough-count'))) input.answers[slot.id] = '모르겠어요';
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[count[0].id] = '2회';
  input.answers[count[1].id] = '1회';
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  assert.match(draft(input).hpi, /오늘 저녁 기침이 몇 번 있었나요\? 1회/u);
});

test('서로 다른 시작 시점은 한 번 명확히 되묻고 끝내 모르면 미확인으로 남긴다', () => {
  const input = confirm(intake('두 번 토했어요. 사료를 절반만 먹었어요.'));
  const onset = intakeQuestions(input).find(slot => slot.id === 'vomit-onset');
  for (const vague of ['어제나 오늘', '어제 또는 오늘', '어제 저녁부터 오늘 새벽 사이']) {
    assert.deepEqual(resolveQuestionAnswer(vague,false,false,onset), {answer:'',clarify:true});
    input.answers[onset.id] = vague;
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  }
  assert.deepEqual(resolveQuestionAnswer('어제 저녁 8시',true,false,onset), {answer:'어제 저녁 8시',clarify:false});
  input.answers[onset.id] = resolveQuestionAnswer('어제나 오늘',true,false,onset).answer;
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  assert.ok(draft(input).missing.includes(onset.label));
});

for (const {complaint, missing, confirmed, onset} of [
  {
    complaint:'어제 처음 토했고 오늘 다시 한 번 토했어요. 밥은 절반만 먹었어요.',
    missing:'어제', confirmed:{label:'오늘 몇 번 토했나요?',text:'1회'}, onset:'어제',
  },
  {
    complaint:'어제 두 번 토했어요. 오늘 또 했어요. 밥은 절반만 먹었어요.',
    missing:'오늘', confirmed:{label:'어제 몇 번 토했나요?',text:'2회'}, onset:null,
  },
]) {
  test(complaint + ' Pages에서 날짜별 구토 횟수를 확인한다', () => {
    const input = confirm(intake(complaint));
    assert.equal(input.answers['vomit-onset'] ?? null, onset);
    input.answers['vomit-onset'] ??= '어제';
    const [slot] = remaining(input);
    assert.deepEqual(remaining(input).map(item => item.label), [missing + ' 몇 번 토했나요?']);
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
    input.answers[slot.id] = '모르겠어요';
    const {id} = pages('/api/intakes',{method:'POST',body:input});
    const result = readPagesDraft(id);
    assert.ok(result.timeline.some(item => item.label === slot.label && item.text === '미확인 (모르겠어요)'));
    assert.ok(result.timeline.some(item => item.label === confirmed.label && item.text === confirmed.text));
    assert.ok(result.missing.includes(slot.label));
  });
}

test('모호한 활력 답변은 한 번 더 묻고 Pages 초안에서 미확인으로 표시한다', () => {
  const input = confirm(intake(short));
  const slot = intakeQuestions(input).find(item => item.id === 'activity');
  for (const value of ['그럭저럭이요', '활력은 그냥 그래요']) {
    assert.deepEqual(resolveQuestionAnswer(value,false,false,slot), {answer:'',clarify:true});
    input.answers[slot.id] = value;
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  }
  assert.match(clarification(slot), /평소/u);
  assert.deepEqual(resolveQuestionAnswer('평소보다 덜 움직여요',true,false,slot),
    {answer:'평소보다 덜 움직여요',clarify:false});
  input.answers[slot.id] = resolveQuestionAnswer('그럭저럭이요',true,false,slot).answer;
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const result = readPagesDraft(id);
  assert.ok(result.hpi.includes(slot.label + ' 미확인 (모르겠어요)'));
  assert.ok(result.missing.includes(slot.label));
});

test('구토 횟수라는 주제 뒤에 이어진 날짜별 횟수를 Pages에서 각각 확인한다', () => {
  const input = confirm(intake('어제부터 토했어요. 토한 횟수는 어제 2회, 오늘 1회예요. 밥은 반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({label,answer,required}) => [label,answer,required]), [
    ['어제 몇 번 토했나요?', '2회', true], ['오늘 몇 번 토했나요?', '1회', true],
  ]);
  const answers = {...input.answers};
  delete answers[counts[1].id];
  assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')), [
    {label:'어제 몇 번 토했나요?',text:'2회'}, {label:'오늘 몇 번 토했나요?',text:'1회'},
  ]);
});

test('음수 비교는 식사량을 확정하지 않는다', () => {
  const input = confirm(intake('어제부터 두 번 토했어요.'));
  const [meal] = remaining(input);
  const reply = '물은 평소와 같고 밥은 먹었어요.';
  assert.equal(meal.id, 'meal');
  assert.deepEqual(resolveQuestionAnswer(reply,false,false,meal), {answer:'',clarify:true});
  input.answers.meal = reply;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  assert.deepEqual(resolveQuestionAnswer(reply,true,false,meal), {answer:'모르겠어요',clarify:false});
  const detailed = '물은 평소와 같고 밥은 반만 먹었어요.';
  assert.deepEqual(resolveQuestionAnswer(detailed,true,false,meal), {answer:detailed,clarify:false});
  input.answers.meal = detailed;
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
});

test('한 문장에서 구토 시작과 이후의 날짜가 있는 경과를 분리한다', () => {
  const input = confirm(intake('어제부터 토했는데 오늘 더 심해졌어요. 밥은 반만 먹었어요.'));
  const slots = intakeQuestions(input);
  assert.equal(input.answers['vomit-onset'], '어제');
  assert.ok(slots.some(slot => slot.label === '오늘 구토 경과는 어떻게 달라졌나요?' && slot.answer === '심해졌어요'));
  assert.deepEqual(remaining(input).map(slot => slot.label), ['이번에 몇 번 토했나요?']);
  input.answers['vomit-count'] = '모르겠어요';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const result = readPagesDraft(id);
  assert.match(result.hpi, /오늘 구토 경과는 어떻게 달라졌나요\? 심해졌어요/u);
});

for (const {complaint, day, count} of [
  {complaint:'어제 처음 두 번 토했어요. 오늘도 두 번이에요. 사료를 절반만 먹었어요.', day:'오늘', count:'2회'},
  {complaint:'어제 두 번 토했고 이틀 전에도 한 번 토했어요. 사료를 절반만 먹었어요.', day:'이틀 전', count:'1회'},
]) {
  test(`${day}의 구토 횟수를 별도로 확인하고 정정한 뒤 Pages에서 조회한다`, () => {
    const input = confirm(intake(complaint));
    const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
    assert.deepEqual(counts.map(({label,answer,required}) => [label,answer,required]), [
      ['어제 몇 번 토했나요?', '2회', true], [`${day} 몇 번 토했나요?`, count, true],
    ]);
    input.answers['vomit-onset'] ??= '이틀 전';
    assert.deepEqual(remaining(input), []);
    for (const {id} of counts) {
      const answers = {...input.answers};
      delete answers[id];
      assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
    }
    const corrected = resolveQuestionAnswer(`${day}에는 세 번 토했어요.`,false,false,counts[1]);
    assert.equal(corrected.clarify, false);
    input.answers[counts[1].id] = corrected.answer;
    const {id} = pages('/api/intakes',{method:'POST',body:input});
    const result = readPagesDraft(id);
    assert.deepEqual(result.timeline.filter(item => item.label.includes('몇 번')), [
      {label:counts[0].label,text:'2회'},
      {label:counts[1].label,text:`${corrected.answer} (보호자 정정)`},
    ]);
    assert.ok(result.timeline.some(item => item.label === `구토 관찰 시점 · ${day}` && item.text === day));
  });
}

for (const {complaint, counts, onsets, observations} of [
  {
    complaint:'어제 두 번 토했어요. 오늘 토했지만 지금은 안 토해요. 사료를 절반만 먹었어요.',
    counts:[['어제 몇 번 토했나요?', '2회'], ['오늘 몇 번 토했나요?', '']],
    onsets:{'vomit-onset':'어제'},
    observations:[['구토', '어제'], ['구토', '오늘']],
  },
  {
    complaint:'어제부터 토했어요. 오늘 아침과 저녁에 구토와 설사가 있었어요. 사료를 절반만 먹었어요.',
    counts:[
      ['오늘 아침 몇 번 토했나요?', ''], ['오늘 저녁 몇 번 토했나요?', ''],
      ['오늘 아침 설사가 몇 번 있었나요?', ''], ['오늘 저녁 설사가 몇 번 있었나요?', ''],
    ],
    onsets:{'diarrhea-onset':'오늘 아침'},
    observations:[['구토', '오늘 아침'], ['구토', '오늘 저녁'], ['설사', '오늘 아침'], ['설사', '오늘 저녁']],
  },
]) {
  test(complaint + ' Pages에서 관찰 시점별 필수 횟수를 검증한다', () => {
    const input = confirm(intake(complaint));
    Object.assign(input.answers, onsets);
    assert.equal(input.answers['vomit-onset'], '어제');
    const slots = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
    assert.deepEqual(slots.map(({label,answer,required}) => [label,answer,required]),
      counts.map(row => [...row,true]));
    assert.deepEqual(remaining(input), slots.filter(slot => !slot.answer));
    for (const [index, slot] of slots.entries()) input.answers[slot.id] ||= (index + 1) + '회';
    for (const slot of slots) {
      const answers = {...input.answers};
      delete answers[slot.id];
      assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/, slot.label);
    }
    const {id} = pages('/api/intakes',{method:'POST',body:input});
    const {timeline} = readPagesDraft(id);
    for (const slot of slots) assert.ok(timeline.some(item => item.label === slot.label && item.text === input.answers[slot.id]));
    for (const [name,period] of observations) {
      assert.ok(timeline.some(item => item.label === name+' 관찰 시점 · '+period && item.text === period));
    }
  });
}

test('식사와 음수를 이어 말하면 후보가 따로 표시되고 식사량을 다시 묻지 않는다', () => {
  const input = confirm(intake('어제부터 두 번 토했어요. 오늘 밥을 반 먹고 물을 평소보다 많이 마셨어요.'));
  const slots = intakeQuestions(input).filter(slot => ['meal','water'].includes(slot.id));
  assert.deepEqual(slots.map(({id,answer}) => [id,answer]), [
    ['meal','밥을 반 먹고'], ['water','물을 평소보다 많이 마셨어요'],
  ]);
  assert.deepEqual(remaining(input), []);
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {hpi} = readPagesDraft(id);
  for (const {label,answer} of slots) assert.ok(hpi.includes(label+' '+answer));
});

test('같은 날의 축약된 시간 표현을 별도 횟수 후보로 연결한다', () => {
  for (const particle of ['에','엔','에는','에도','도','은','']) {
    const input = confirm(intake('어제 아침 두 번 토했고 저녁'+particle+' 세 번 했어요. 사료를 절반만 먹었어요.'));
    const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
    assert.deepEqual(counts.map(({period,answer}) => [period,answer]),
      [['어제 아침','2회'],['어제 저녁','3회']], particle);
    if (particle === '엔') {
      input.answers['vomit-onset'] = '어제 아침';
      const evening = counts[1];
      delete input.answers[evening.id];
      assert.deepEqual(remaining(input).map(slot => slot.id), [evening.id]);
      assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
      input.answers[evening.id] = evening.answer;
      assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
    }
  }
});

test('명시된 시작만 말한 뒤 다른 날 반복됐다고 답하면 그날 횟수를 묻는다', () => {
  for (const reply of ['오늘도 그랬어요','오늘에도 또 했어요','오늘 또 했어요']) {
    const input = confirm(intake('어제부터 토했어요. '+reply+'. 사료를 절반만 먹었어요.'));
    assert.equal(input.answers['vomit-onset'], '어제');
    const [count] = remaining(input);
    assert.equal(count.label, '오늘 몇 번 토했나요?');
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
    input.answers[count.id] = '모르겠어요';
    assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  }
});

test('증상 진행 중 다른 날의 악화를 말하면 날짜와 시작을 따로 기록한다', () => {
  const input = confirm(intake('어제부터 토하다가 오늘 심해졌어요. 사료를 절반만 먹었어요.'));
  assert.equal(input.answers['vomit-onset'], '어제');
  assert.ok(intakeQuestions(input).some(slot =>
    slot.label === '오늘 구토 경과는 어떻게 달라졌나요?' && slot.answer === '심해졌어요'));
});

test('오늘 토한 뒤 좋아졌어도 오늘 횟수를 Pages에서 확인해야 한다', () => {
  const input = confirm(intake('그제부터 구토했어요. 어제 한 번 토했고 오늘 토한 뒤 좋아졌어요. 밥을 절반 먹었어요.'));
  assert.equal(input.answers['vomit-onset'], '그제');
  const [count] = remaining(input);
  assert.deepEqual(remaining(input).map(slot => slot.label), ['오늘 몇 번 토했나요?']);
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[count.id] = '모르겠어요';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {timeline,hpi} = readPagesDraft(id);
  assert.ok(timeline.some(item => item.label === '구토 관찰 시점 · 오늘' && item.text === '오늘'));
  assert.match(hpi, /오늘 구토 경과는 어떻게 달라졌나요\? 좋아졌어요/u);
  assert.match(hpi, /오늘 몇 번 토했나요\? 미확인 \(모르겠어요\)/u);
});

test('오늘은 오전에 한 번 밤에 두 번 토하면 시간대별로 확인하고 정정한다', () => {
  const input = confirm(intake('그제부터 구토했어요. 어제 두 번 토했어요. 오늘은 오전에 한 번 밤에 두 번 토했어요. 밥을 절반 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({period,answer,required}) => [period,answer,required]), [
    ['어제','2회',true], ['오늘 오전','1회',true], ['오늘 밤','2회',true],
  ]);
  for (const slot of counts.slice(1)) {
    const answers = {...input.answers};
    delete answers[slot.id];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  input.answers[counts[1].id] = '3회';
  assert.deepEqual(remaining(input), []);
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {timeline,hpi} = readPagesDraft(id);
  assert.deepEqual(timeline.filter(item => item.label.includes('몇 번')), [
    {label:counts[0].label,text:'2회'}, {label:counts[1].label,text:'3회 (보호자 정정)'}, {label:counts[2].label,text:'2회'},
  ]);
  assert.match(hpi, /오늘 오전 몇 번 토했나요\? 3회 \(보호자 정정\)/u);
});

test('명시한 물 한 컵은 식사량과 별도 후보로 Pages 초안에 반영한다', () => {
  const input = confirm(intake('어제부터 두 번 토했어요. 밥을 절반 먹었어요. 물을 한 컵 마셨어요.'));
  assert.equal(input.answers.meal, '밥을 절반 먹었어요');
  assert.equal(input.answers.water, '물을 한 컵 마셨어요');
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.match(readPagesDraft(id).hpi, /물은 평소와 비교해 얼마나 마셨나요\? 물을 한 컵 마셨어요/u);
});

test('반복 구토의 횟수를 원문에서 모른다고 해도 해당 날짜의 직접 답변이 필요하다', () => {
  const input = confirm(intake('사흘 전부터 토했어요. 어제 두 번 토했어요. 오늘은 또 그랬는데 몇 번인지 모르겠어요. 사료를 절반만 먹었어요.'));
  const label = '오늘 몇 번 토했나요?';
  const [slot] = remaining(input);
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  assert.deepEqual(remaining(input).map(item => item.label), [label]);
  assert.equal(slot.candidate, null);
  input.answers[slot.id] = resolveQuestionAnswer('모르겠어요',false,false,slot).answer;
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {hpi,missing} = readPagesDraft(id);
  assert.ok(hpi.includes(label + ' 미확인 (모르겠어요)'));
  assert.ok(missing.includes(label));
  assert.match(hpi, /어제 몇 번 토했나요\? 2회/u);
});

test('각각이라고 명시하면 같은 횟수를 시간대별 후보로 확인할 수 있다', () => {
  const input = confirm(intake('어제 오전 8시와 오후 3시에 각각 한 번 토했어요. 사료를 절반만 먹었어요.'));
  input.answers['vomit-onset'] = '어제 오전 8시';
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({period,answer}) => [period,answer]),
    [['어제 오전 8시','1회'],['어제 오후 3시','1회']]);
  input.answers[counts[0].id] = '2회';
  assert.deepEqual(remaining(input), []);
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {timeline} = readPagesDraft(id);
  assert.ok(timeline.some(item => item.label === counts[0].label && item.text === '2회 (보호자 정정)'));
  assert.ok(timeline.some(item => item.label === counts[1].label && item.text === '1회'));
});

test('재진 경과의 모호한 답변은 한 번 되묻고 계속 모호하면 미확인으로 남긴다', () => {
  const input = confirm(intake(short,{visitType:'return'}));
  const slot = remaining(input).find(item => item.id === 'vomit-course');
  assert.deepEqual(resolveQuestionAnswer('그럭저럭이에요',false,false,slot), {answer:'',clarify:true});
  assert.match(clarification(slot), /좋아졌나요.*심해졌나요.*그대로인가요/u);
  assert.deepEqual(resolveQuestionAnswer('그럭저럭이에요',true,false,slot), {answer:'모르겠어요',clarify:false});
  assert.deepEqual(resolveQuestionAnswer('전보다 구토가 줄었어요',true,false,slot),
    {answer:'전보다 구토가 줄었어요',clarify:false});
});

test('오늘도 함께 관찰한 두 증상은 각각 오늘 횟수 확인이 필요하다', () => {
  for (const reply of ['오늘도 설사랑 구토를 했어요','오늘에도 구토와 설사가 있었어요']) {
    const input = confirm(intake('어제 두 번 토했고 '+reply+'. 사료를 절반만 먹었어요.'));
    const slots = intakeQuestions(input).filter(slot => /^(vomit|diarrhea)-count/u.test(slot.id));
    assert.deepEqual(slots.map(({id,period,answer}) => [id.split('-')[0],period,answer]), [
      ['vomit','어제','2회'],['vomit','오늘',''],['diarrhea','오늘',''],
    ]);
    for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
    for (const {id} of slots.filter(slot => slot.period === '오늘')) {
      const answers = {...input.answers};
      delete answers[id];
      assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
    }
    assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  }
});

test('다음과 다음에로 연결된 연속 관찰에서 날짜별 횟수를 확인한다', () => {
  for (const link of ['다음','다음에']) {
    const input = confirm(intake('어제 두 번 토한 '+link+' 오늘 한 번 더 토했어요. 사료를 절반만 먹었어요.'));
    const slots = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
    assert.deepEqual(slots.map(({period,answer}) => [period,answer]), [['어제','2회'],['오늘','1회']]);
  }
});

test('밥그릇 부재는 관찰한 식사량이 아니므로 한 번 다시 묻는다', () => {
  const input = confirm(intake('어제부터 두 번 토했어요.'));
  const slot = remaining(input).find(item => item.id === 'meal');
  const reply = '밥그릇이 없어요.';
  assert.deepEqual(resolveQuestionAnswer(reply,false,false,slot), {answer:'',clarify:true});
  assert.deepEqual(resolveQuestionAnswer(reply,true,false,slot), {answer:'모르겠어요',clarify:false});
  input.answers[slot.id] = reply;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[slot.id] = '아예 안 먹었어요.';
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
});

test('명시한 구토와 설사만 시작 시점을 공유하고 앞서 말한 기침은 별도로 확인한다', () => {
  const input = confirm(intake('오늘 기침 한 번 했어요. 구토와 설사는 둘 다 어제부터예요. 사료를 절반만 먹었어요.'));
  assert.deepEqual(intakeQuestions(input).filter(slot => slot.id.endsWith('-onset'))
    .map(({id,answer}) => [id,answer]).sort(),
  [['cough-onset',''],['diarrhea-onset','어제'],['vomit-onset','어제']]);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  for (const key of ['vomit-count','diarrhea-count']) {
    const answers = {...input.answers};
    delete answers[key];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.match(readPagesDraft(id).hpi, /설사의 첫 증상은 언제였나요\? 어제/u);
});

test('같은 날 이어 말한 구토와 설사는 날짜별 횟수를 확인하고 한 값만 정정한다', () => {
  const input = confirm(intake('어제는 두 번 토하고 설사를 세 번 했어요. 오늘은 한 번 토하고 설사를 네 번 했어요. 사료를 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(({id,period,answer}) => [id.split('-')[0],period,answer]), [
    ['vomit','어제','2회'],['diarrhea','어제','3회'],['vomit','오늘','1회'],['diarrhea','오늘','4회'],
  ]);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  for (const {id} of counts) {
    const answers = {...input.answers};
    delete answers[id];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  input.answers[counts[1].id] = '5회';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')), [
    {label:counts[0].label,text:'2회'}, {label:counts[1].label,text:'5회 (보호자 정정)'},
    {label:counts[2].label,text:'1회'}, {label:counts[3].label,text:'4회'},
  ]);
  const saved = intake(input.complaint,{draft:{timeline:[]},answers:{'diarrhea-count':'3회'}});
  assert.equal(intakeQuestions(saved).find(slot => slot.id === 'diarrhea-count')?.answer,'3회');

  const separate = confirm(intake('어제 두 번 토하고 오늘은 설사를 세 번 했어요.'));
  assert.deepEqual(intakeQuestions(separate).filter(slot => slot.id.includes('-count'))
    .map(({period,answer}) => [period,answer]), [['어제','2회'],['오늘','3회']]);
});

test('배뇨 빈도가 어떻게 달라졌는지 한 번 되묻고 모르면 Pages 초안에 미확인으로 남긴다', () => {
  const input = confirm(intake('어제부터 구토했어요. 소변 양이 줄었어요. 사료를 절반만 먹었어요.'));
  const slot = remaining(input).find(item => item.id === 'urine-frequency');
  for (const other of remaining(input)) input.answers[other.id] = '모르겠어요';
  const reply = '평소와 달라요.';
  assert.deepEqual(resolveQuestionAnswer(reply,false,false,slot), {answer:'',clarify:true});
  assert.deepEqual(resolveQuestionAnswer('소변 보는 횟수가 평소랑 달라요.',false,false,slot),
    {answer:'',clarify:true});
  assert.match(clarification(slot), /더 자주.*덜 자주/u);
  const resolved = resolveQuestionAnswer(reply,true,false,slot);
  assert.deepEqual(resolved, {answer:'모르겠어요',clarify:false});
  for (const answer of ['더 자주 봤어요.', '하루에 세 번 봤어요.', '평소와 같아요.', '없어요.']) {
    assert.deepEqual(resolveQuestionAnswer(answer,true,false,slot), {answer,clarify:false});
  }
  input.answers[slot.id] = reply;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[slot.id] = resolved.answer;
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {hpi,missing} = readPagesDraft(id);
  assert.ok(missing.includes(slot.label));
  assert.ok(hpi.includes(slot.label + ' 미확인 (모르겠어요)'));
  assert.match(hpi, /소변 양이 줄었어요/u);
});

test('오늘 토한 뒤 현재 구토가 멈춰도 어제와 오늘 횟수를 각각 확인한다', () => {
  const input = confirm(intake('어제 토했어요. 오늘 토한 뒤 지금은 토하지 않아요. 밥은 절반 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({label,required,answer}) => [label,required,answer]), [
    ['어제 몇 번 토했나요?',true,''], ['오늘 몇 번 토했나요?',true,''],
  ]);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  delete input.answers[counts[1].id];
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[counts[1].id] = '1회';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.match(readPagesDraft(id).hpi, /오늘 몇 번 토했나요\? 1회/u);
});

test('오늘은 구토도 하고 설사도 했으면 각 증상에 오늘 횟수 질문이 생긴다', () => {
  const input = confirm(intake('어제 토했어요. 오늘은 구토도 하고 설사도 했어요. 밥은 절반 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(({label,required,answer}) => [label,required,answer]), [
    ['어제 몇 번 토했나요?',true,''], ['오늘 몇 번 토했나요?',true,''],
    ['오늘 설사가 몇 번 있었나요?',true,''],
  ]);
  for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
  for (const {id} of counts) {
    const answers = {...input.answers};
    delete answers[id];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
});

test('재진 병력에 식사량으로 답하면 한 번 되묻고 계속 벗어나면 미확인으로 남긴다', () => {
  const input = confirm(intake(short + ' 먹는 약은 없어요. 지난 진료 이후 괜찮았어요.', {visitType:'return'}));
  const slot = remaining(input).find(item => item.id === 'history');
  const reply = '밥은 절반 먹었어요';
  assert.deepEqual(resolveQuestionAnswer(reply,false,false,slot), {answer:'',clarify:true});
  assert.match(clarification(slot), /진단받은 질환의 이름/u);
  const resolved = resolveQuestionAnswer(reply,true,false,slot);
  assert.deepEqual(resolved, {answer:'모르겠어요',clarify:false});
  for (const other of remaining(input)) input.answers[other.id] = '모르겠어요';
  input.answers.history = reply;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /병력 후속 질문/);
  input.answers.history = resolved.answer;
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {hpi,missing} = readPagesDraft(id);
  assert.ok(missing.includes(slot.label));
  assert.ok(hpi.includes(slot.label + ' 미확인 (모르겠어요)'));
  assert.equal(input.answers.meal, '사료를 절반만 먹었어요');
});

test('토를 했다는 날짜를 관찰로 인정하되 부정 진술은 횟수를 만들지 않는다', () => {
  for (const reply of ['토를 했어요','토도 했어요','구토를 했어요']) {
    const input = confirm(intake('어제 두 번 토했어요. 오늘은 '+reply+'. 밥은 절반 먹었어요.'));
    input.answers['vomit-onset'] = '어제';
    const pending = remaining(input);
    assert.deepEqual(pending.map(({label}) => label), ['오늘 몇 번 토했나요?']);
    assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
    input.answers[pending[0].id] = '모르겠어요';
    assert.ok(pages('/api/intakes',{method:'POST',body:input}).id);
  }
  const negated = intake('어제 두 번 토했어요. 오늘은 토를 하지 않았어요. 밥은 절반 먹었어요.');
  assert.ok(!intakeQuestions(negated).some(slot => slot.label === '오늘 몇 번 토했나요?'));
});

test('어느 쪽으로 달라 보였는지 모호하면 활력 답변을 다시 묻는다', () => {
  const slot = intakeQuestions(intake(short)).find(item => item.id === 'activity');
  for (const reply of ['평소랑 좀 달라 보였어요.','기운이 평소보다 조금 달라 보여요.']) {
    assert.deepEqual(resolveQuestionAnswer(reply,false,false,slot), {answer:'',clarify:true});
    assert.deepEqual(resolveQuestionAnswer(reply,true,false,slot), {answer:'모르겠어요',clarify:false});
  }
  assert.deepEqual(resolveQuestionAnswer('평소보다 덜 움직였어요.',false,false,slot),
    {answer:'평소보다 덜 움직였어요.',clarify:false});
});

test('같은 날 쉼표로 이어진 단독 시각의 필수 횟수를 Pages에서 각각 확인한다', () => {
  const input = confirm(intake('오늘 오전 8시에 한 번, 10시에 두 번 토했어요. 처음 토한 건 어제였어요. 사료를 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({period,answer,required}) => [period,answer,required]), [
    ['오늘 오전 8시','1회',true], ['오늘 10시','2회',true],
  ]);
  assert.equal(input.answers['vomit-onset'], '어제');
  for (const {id} of counts) {
    const answers = {...input.answers};
    delete answers[id];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')),
    counts.map(({label,answer}) => ({label,text:answer})));
});

test('하고로 연결해 시작 시점을 공유한 두 증상의 필수 횟수를 각각 확인한다', () => {
  const input = confirm(intake('어제부터 기침했어요. 구토하고 설사 둘 다 오늘부터였어요. 사료를 절반만 먹었어요.'));
  assert.deepEqual(intakeQuestions(input).filter(slot => slot.id.endsWith('-onset'))
    .map(({id,answer}) => [id,answer]).sort(), [
    ['cough-onset','어제'], ['diarrhea-onset','오늘'], ['vomit-onset','오늘'],
  ]);
  assert.deepEqual(remaining(input).map(({id}) => id).sort(), ['cough-count','diarrhea-count','vomit-count']);
  Object.assign(input.answers, {'cough-count':'3회','vomit-count':'1회','diarrhea-count':'2회'});
  for (const key of ['vomit-count','diarrhea-count']) {
    const answers = {...input.answers};
    delete answers[key];
    assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  }
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.match(readPagesDraft(id).hpi, /설사의 첫 증상은 언제였나요\? 오늘/u);
});

test('다른 단독 시각의 정정은 재확인하고 해당 시각의 답만 초안에 반영한다', () => {
  const input = confirm(intake('어제부터 토했어요. 오늘 오전 8시에 한 번, 오전 10시에 두 번 토했어요. 사료를 절반만 먹었어요.'));
  const [eight,ten] = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  const reply = '10시에 두 번 토했어요.';
  assert.deepEqual(resolveQuestionAnswer(reply,false,false,eight), {answer:'',clarify:true});
  assert.match(clarification(eight), /^오늘 오전 8시/u);
  assert.deepEqual(resolveQuestionAnswer(reply,true,false,eight), {answer:'모르겠어요',clarify:false});
  input.answers[eight.id] = reply;
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /횟수 후속 질문/);
  const correction = '8시에 세 번 토했어요.';
  assert.deepEqual(resolveQuestionAnswer(correction,true,false,eight), {answer:correction,clarify:false});
  input.answers[eight.id] = correction;
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')), [
    {label:eight.label,text:correction+' (보호자 정정)'}, {label:ten.label,text:'2회'},
  ]);
});

for (const [complaint, expected] of [
  ['어제 두 번 토했어요. 오늘은 구토와 설사 모두 있었어요.', [
    ['어제 몇 번 토했나요?','2회'], ['오늘 몇 번 토했나요?',''], ['오늘 설사가 몇 번 있었나요?',''],
  ]],
  ['어제 두 번 토했어요. 오늘은 설사도 두 번 하고 구토도 한 번 했어요.', [
    ['어제 몇 번 토했나요?','2회'], ['오늘 설사가 몇 번 있었나요?','2회'], ['오늘 몇 번 토했나요?','1회'],
  ]],
  ['어제는 총 두 번 토했고 오늘은 총 세 번 토했어요.', [
    ['어제 몇 번 토했나요?','2회'], ['오늘 몇 번 토했나요?','3회'],
  ]],
]) {
  test('날짜별 필수 횟수와 Pages 초안 · '+complaint, () => {
    const input = confirm(intake(complaint+' 밥은 평소처럼 먹었어요.'));
    const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
    assert.deepEqual(counts.map(({label,answer,required}) => [label,answer,required]),
      expected.map(([label,answer]) => [label,answer,true]));
    for (const slot of remaining(input)) input.answers[slot.id] = '모르겠어요';
    for (const {id} of counts) {
      const answers = {...input.answers};
      delete answers[id];
      assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
    }
    const {id} = pages('/api/intakes',{method:'POST',body:input});
    const {timeline,missing} = readPagesDraft(id);
    assert.deepEqual(timeline.filter(item => item.label.includes('몇 번')),
      expected.map(([label,answer]) => ({label,text:answer || '미확인 (모르겠어요)'})));
    for (const [label,answer] of expected) assert.equal(missing.includes(label), !answer);
  });
}

test('같은 날짜의 나란한 횟수는 각각 증상에 연결하고 Pages에서 필수로 확인한다', () => {
  for (const join of [' 및 ',' 그리고 ','와 ','이랑 ']) {
    const input = confirm(intake('어제 두 번 토했어요. 오늘은 구토 1회'+join+
      '설사 3회였어요. 둘 다 어제부터예요. 밥은 절반 먹었어요.'));
    const counts = intakeQuestions(input).filter(slot => /^(vomit|diarrhea)-count/u.test(slot.id));
    assert.deepEqual(counts.map(({id,period,answer}) => [id.split('-')[0],period,answer]), [
      ['vomit','어제','2회'],['vomit','오늘','1회'],['diarrhea','오늘','3회'],
    ], join);
    for (const {id} of counts) {
      const answers = {...input.answers};
      delete answers[id];
      assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
    }
    input.answers[counts[1].id] = '2회';
    const {id} = pages('/api/intakes',{method:'POST',body:input});
    assert.deepEqual(readPagesDraft(id).timeline.filter(item => item.label.includes('몇 번')), [
      {label:counts[0].label,text:'2회'}, {label:counts[1].label,text:'2회 (보호자 정정)'},
      {label:counts[2].label,text:'3회'},
    ]);
  }
});

test('요일별 구토 관찰과 시작을 구분하고 수요일 횟수 없이 Pages 접수를 거부한다', () => {
  const input = confirm(intake('월요일부터 토했어요. 화요일에 두 번 토했어요. 수요일에도 토했어요. 밥은 절반만 먹었어요.'));
  assert.equal(input.answers['vomit-onset'], '월요일');
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({period,answer,required}) => [period,answer,required]), [
    ['화요일','2회',true], ['수요일','',true],
  ]);
  assert.throws(() => pages('/api/intakes',{method:'POST',body:input}), /후속 질문/);
  input.answers[counts[1].id] = '모르겠어요';
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {timeline} = readPagesDraft(id);
  for (const {period} of counts) {
    assert.ok(timeline.some(item => item.label === '구토 관찰 시점 · '+period && item.text === period));
  }
  assert.ok(timeline.some(item => item.label === counts[0].label && item.text === '2회'));
  assert.ok(timeline.some(item => item.label === counts[1].label && item.text === '미확인 (모르겠어요)'));
});

test('구토와 설사의 사료 변경은 방문당 한 번 표시하며 확인한 답은 재질문하지 않는다', () => {
  const input = confirm(intake(dated+' 사료를 바꾸지 않았어요.'));
  const slots = intakeQuestions(input).filter(slot => slot.id === 'exposure');
  assert.equal(slots.length, 1);
  assert.equal(slots[0].required, false);
  assert.equal(slots[0].status, 'confirmed');
  assert.match(slots[0].answer, /바꾸지 않았어요/u);
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.match(readPagesDraft(id).hpi, /최근 사료를 바꿨나요\? 사료를 바꾸지 않았어요/u);
  const incomplete = confirm(intake(dated));
  assert.ok(pages('/api/intakes',{method:'POST',body:incomplete}).id);
});

test('오늘 또 한 번은 직전 구토를 이어받아 오늘의 필수 횟수로 접수한다', () => {
  const input = confirm(intake('어제 한 번 토했어요. 오늘 또 한 번. 밥은 평소보다 적게 먹었어요.'));
  input.answers['vomit-onset'] = '어제';
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({period,answer,required}) => [period,answer,required]), [
    ['어제','1회',true], ['오늘','1회',true],
  ]);
  assert.deepEqual(remaining(input), []);
  const answers = {...input.answers};
  delete answers[counts[1].id];
  assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {timeline} = readPagesDraft(id);
  assert.deepEqual(timeline.filter(item => item.label.includes('몇 번')), [
    {label:counts[0].label,text:'1회'}, {label:counts[1].label,text:'1회'},
  ]);
  assert.ok(timeline.some(item => item.label === '구토 관찰 시점 · 오늘' && item.text === '오늘'));
});

test('오늘은 세 번이었어요를 별도 필수 횟수로 확인하고 Pages 초안에 표시한다', () => {
  const input = confirm(intake('어제부터 토했어요. 어제는 두 번 토했고 오늘은 세 번이었어요. 밥은 평소와 같아요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.startsWith('vomit-count'));
  assert.deepEqual(counts.map(({period,answer,required}) => [period,answer,required]), [
    ['어제','2회',true], ['오늘','3회',true],
  ]);
  assert.deepEqual(remaining(input), []);
  const answers = {...input.answers};
  delete answers[counts[1].id];
  assert.throws(() => pages('/api/intakes',{method:'POST',body:{...input,answers}}), /후속 질문/);
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  const {hpi,timeline} = readPagesDraft(id);
  for (const {label,answer,period} of counts) {
    assert.ok(hpi.includes(label+' '+answer));
    assert.ok(timeline.some(item => item.label === label && item.text === answer));
    assert.ok(timeline.some(item => item.label === '구토 관찰 시점 · '+period && item.text === period));
  }
});

test('또 한 번은 직전 증상이 여럿이면 어느 증상의 횟수인지 추정하지 않는다', () => {
  const input = confirm(intake('어제 구토와 설사가 있었어요. 오늘 또 한 번. 밥은 절반만 먹었어요.'));
  const counts = intakeQuestions(input).filter(slot => slot.id.includes('-count'));
  assert.deepEqual(counts.map(({period,answer}) => [period,answer]), [['어제',''],['어제','']]);
});

test('평소와 같다는 식사량을 후보에서 확인하면 다시 묻지 않는다', () => {
  const input = confirm(intake('어제부터 두 번 토했어요. 밥은 평소와 같아요.'));
  assert.equal(input.answers.meal, '밥은 평소와 같아요');
  assert.deepEqual(remaining(input), []);
  const {id} = pages('/api/intakes',{method:'POST',body:input});
  assert.match(readPagesDraft(id).hpi, /밥은 평소와 비교해 얼마나 먹었나요\? 밥은 평소와 같아요/u);
  for (const id of ['water','activity','stool']) {
    assert.equal(intakeQuestions(input).find(slot => slot.id === id).status, 'pending');
  }
  for (const clause of ['밥은 평소와 같아요?', '밥은 평소와 같지 않아요.']) {
    assert.equal(intakeQuestions(intake('어제부터 두 번 토했어요. '+clause))
      .find(slot => slot.id === 'meal').candidate, null);
  }
});
